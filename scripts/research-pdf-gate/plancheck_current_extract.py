"""Evaluate PlanCheck's current page-preserving PDF transcription path.

This adapter imports the EXTRACT seam from ``run_tender_detection.py`` rather
than the legacy ``run_check.py`` assessment extractor.  It deliberately runs
only the first ``--max-pages`` physical pages of one public PDF, records every
page state, and then replays the same pages through an ephemeral transcription
cache so cold and warm behaviour can be compared without touching PlanCheck's
application cache.
"""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import sys
import tempfile
import time
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, required=True)
    parser.add_argument("--max-usd", type=float, default=1.0)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--execute-vision", action="store_true")
    return parser.parse_args()


def subset_pdf(data: bytes, max_pages: int, pymupdf: Any) -> tuple[bytes, int]:
    source = pymupdf.open(stream=data, filetype="pdf")
    output = pymupdf.open()
    try:
        total_pages = len(source)
        parsed_pages = min(total_pages, max_pages)
        if parsed_pages < 1:
            raise ValueError("The selected PDF has no pages inside the configured cap.")
        output.insert_pdf(source, from_page=0, to_page=parsed_pages - 1)
        return output.tobytes(), total_pages
    finally:
        output.close()
        source.close()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def cost_for(outcome: Any, *, model: str, cost_of: Any) -> dict[str, Any]:
    primary_usd = cost_of(
        model,
        input_tokens=outcome.input_tokens,
        output_tokens=outcome.output_tokens,
    )
    escalation_usd = (
        cost_of(
            outcome.escalation_model,
            input_tokens=outcome.escalation_input_tokens,
            output_tokens=outcome.escalation_output_tokens,
        )
        if outcome.escalation_model
        else 0.0
    )
    known_usd = float(primary_usd or 0.0) + float(escalation_usd or 0.0)
    return {
        "knownUsd": round(known_usd, 6),
        "primaryUsd": round(float(primary_usd or 0.0), 6),
        "escalationUsd": round(float(escalation_usd or 0.0), 6),
        # A content-filter refusal returns no token receipt through this seam.
        # It may still be billable, so never call the known-token total complete
        # when the fallback chain had to make another request.
        "accountingComplete": outcome.policy_fallback_attempts == 0,
    }


def page_payload(document: Any) -> list[dict[str, Any]]:
    return [
        {
            "pageNumber": page.page,
            "content": page.text,
            "source": page.source,
            "reason": page.reason,
            "textCharacters": page.text_chars,
            "renderPx": page.render_px,
            "truncated": page.truncated,
            "fromCache": page.from_cache,
            "inputTokens": page.input_tokens,
            "outputTokens": page.output_tokens,
            "reproducible": page.reproducible,
            "transcriptionChain": page.transcription_chain,
        }
        for page in document.page_records
    ]


def run_once(
    *,
    corpus: Path,
    filename: str,
    subset_sha256: str,
    cache: Any,
    read_document: Any,
    transcribe_zero_text_pages: Any,
    model: str,
    escalation_model: str,
    cost_of: Any,
) -> dict[str, Any]:
    document = read_document(corpus / filename, filename, subset_sha256)
    started = time.perf_counter()
    diagnostics = io.StringIO()
    with contextlib.redirect_stdout(diagnostics):
        outcome = transcribe_zero_text_pages(
            corpus,
            [document],
            model=model,
            escalation_model=escalation_model,
            workers=4,
            max_transcriptions=len(document.page_records),
            cache=cache,
        )
    if diagnostics.getvalue():
        print(diagnostics.getvalue(), file=sys.stderr, end="")
    pages = page_payload(document)
    incomplete_pages = [
        page["pageNumber"]
        for page in pages
        if page["source"] not in {"text_layer", "transcription"} or page["truncated"]
    ]
    content = "\n\n".join(
        f"<!-- page {page['pageNumber']} -->\n{page['content']}" for page in pages
    )
    return {
        "durationMs": round((time.perf_counter() - started) * 1000),
        "content": content,
        "pages": pages,
        "extractionCompleteWithinCap": not incomplete_pages
        and not outcome.failures
        and not outcome.capped
        and not outcome.aborted,
        "incompletePages": incomplete_pages,
        "failures": outcome.failures,
        "policyBlocked": outcome.policy_blocked,
        "cappedPages": outcome.capped,
        "aborted": outcome.aborted or None,
        "usage": {
            "providerCallsReturned": outcome.calls,
            "attempts": outcome.attempts,
            "cacheHits": outcome.cache_hits,
            "inputTokens": outcome.input_tokens,
            "outputTokens": outcome.output_tokens,
            "policyFallbackAttempts": outcome.policy_fallback_attempts,
            "policyFallbackClears": outcome.policy_fallback_clears,
            "policyResampledPages": outcome.policy_resampled,
            "escalationModel": outcome.escalation_model or None,
            "escalationInputTokens": outcome.escalation_input_tokens,
            "escalationOutputTokens": outcome.escalation_output_tokens,
            **cost_for(outcome, model=model, cost_of=cost_of),
        },
    }


def main() -> None:
    args = parse_args()
    if args.max_pages < 1:
        raise ValueError("--max-pages must be positive.")
    if not 0 < args.max_usd <= 10:
        raise ValueError("--max-usd must be greater than zero and no more than 10.")

    repository = args.repository.resolve()
    source_path = args.source.resolve()
    sys.path.insert(0, str(repository))

    import pymupdf

    from backend.detection.model_choice import (
        TRANSCRIPTION_ESCALATION_MODEL,
        TRANSCRIPTION_MODEL,
    )
    from backend.engine.page_transcription_cache import PageTranscriptionCache
    from backend.engine.pricing import cost_of
    from run_tender_detection import read_document, transcribe_zero_text_pages

    original = source_path.read_bytes()
    original_sha256 = sha256(original)
    subset, total_pages = subset_pdf(original, args.max_pages, pymupdf)
    subset_sha256 = sha256(subset)
    parsed_pages = min(total_pages, args.max_pages)

    with tempfile.TemporaryDirectory(prefix="plancheck-current-pdf-gate-") as temporary:
        root = Path(temporary)
        filename = source_path.name
        (root / filename).write_bytes(subset)
        plan = read_document(root / filename, filename, subset_sha256)
        zero_text_pages = [
            page.page
            for page in plan.page_records
            if page.source == "not_read"
            and page.reason.startswith("text layer yields zero")
        ]
        base = {
            "extractorRoute": "current-detection-transcription",
            "sourceSha256": original_sha256,
            "subsetSha256": subset_sha256,
            "sourceBytes": len(original),
            "totalPages": total_pages,
            "parsedPages": parsed_pages,
            "pageCapTruncated": total_pages > parsed_pages,
            "zeroTextPages": zero_text_pages,
            "transcriptionModel": TRANSCRIPTION_MODEL,
            "escalationModel": TRANSCRIPTION_ESCALATION_MODEL,
            "visionConfigured": bool(os.environ.get("ANTHROPIC_API_KEY")),
            "maxUsd": args.max_usd,
        }
        if args.plan_only:
            print(json.dumps(base))
            return
        if zero_text_pages and not args.execute_vision:
            raise RuntimeError(
                "Pass --execute-vision after reviewing the PlanCheck transcription preflight."
            )
        if zero_text_pages and not base["visionConfigured"]:
            raise RuntimeError(
                "ANTHROPIC_API_KEY is required for the current PlanCheck transcription path."
            )

        cache = PageTranscriptionCache(root / "cache")
        cold = run_once(
            corpus=root,
            filename=filename,
            subset_sha256=subset_sha256,
            cache=cache,
            read_document=read_document,
            transcribe_zero_text_pages=transcribe_zero_text_pages,
            model=TRANSCRIPTION_MODEL,
            escalation_model=TRANSCRIPTION_ESCALATION_MODEL,
            cost_of=cost_of,
        )
        if cold["usage"]["knownUsd"] > args.max_usd:
            warm = {
                "skipped": True,
                "reason": "Cold-run known token cost exceeded --max-usd; cache replay was not started.",
            }
        else:
            warm = run_once(
                corpus=root,
                filename=filename,
                subset_sha256=subset_sha256,
                cache=cache,
                read_document=read_document,
                transcribe_zero_text_pages=transcribe_zero_text_pages,
                model=TRANSCRIPTION_MODEL,
                escalation_model=TRANSCRIPTION_ESCALATION_MODEL,
                cost_of=cost_of,
            )
        known_total = cold["usage"]["knownUsd"] + float(
            warm.get("usage", {}).get("knownUsd", 0.0)
        )
        print(
            json.dumps(
                {
                    **base,
                    "knownTotalUsd": round(known_total, 6),
                    "cold": cold,
                    "warm": warm,
                    "cacheScope": "ephemeral benchmark-only cache; deleted after this process",
                }
            )
        )


if __name__ == "__main__":
    main()
