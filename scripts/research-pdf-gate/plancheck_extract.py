"""Run the real PlanCheck text-first PDF extractor for the research PDF gate."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import io
import json
import os
import sys
import time
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--max-pages", type=int, required=True)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--execute-vision", action="store_true")
    return parser.parse_args()


def subset_pdf(data: bytes, max_pages: int, pymupdf: Any) -> tuple[bytes, int]:
    source = pymupdf.open(stream=data, filetype="pdf")
    output = pymupdf.open()
    try:
        total_pages = len(source)
        output.insert_pdf(source, from_page=0, to_page=min(total_pages, max_pages) - 1)
        return output.tobytes(), total_pages
    finally:
        output.close()
        source.close()


def split_pages(text: str, page_marker: Any) -> list[dict[str, Any]]:
    matches = list(page_marker.finditer(text or ""))
    pages: list[dict[str, Any]] = []
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        pages.append(
            {
                "pageNumber": int(match.group(1)),
                "content": text[match.end() : end].strip(),
            }
        )
    return pages


def main() -> None:
    args = parse_args()
    repository = args.repository.resolve()
    source_path = args.source.resolve()
    sys.path.insert(0, str(repository))

    import pymupdf

    from backend.engine.assessment_engine import extract_via_vision
    from backend.engine.text_extraction import PAGE_MARKER, extract_pdf, plan_pdf

    original = source_path.read_bytes()
    original_sha256 = hashlib.sha256(original).hexdigest()
    subset, total_pages = subset_pdf(original, args.max_pages, pymupdf)
    started = time.perf_counter()
    with contextlib.redirect_stdout(sys.stderr):
        plan = plan_pdf(subset, source_path.name)
    sparse_pages = [item.page for item in plan.page_plans if item.needs_vision]
    base = {
        "sourceSha256": original_sha256,
        "sourceBytes": len(original),
        "totalPages": total_pages,
        "parsedPageLimit": min(total_pages, args.max_pages),
        "sparsePages": sparse_pages,
        "visionConfigured": bool(os.environ.get("ANTHROPIC_API_KEY")),
    }
    if args.plan_only:
        print(json.dumps(base))
        return

    if sparse_pages and args.execute_vision and not base["visionConfigured"]:
        raise RuntimeError("ANTHROPIC_API_KEY is required for the planned PlanCheck vision pages")

    diagnostic_output = io.StringIO()
    with contextlib.redirect_stdout(diagnostic_output):
        outcome = extract_pdf(
            subset,
            source_path.name,
            vision_fn=extract_via_vision if args.execute_vision else None,
            plan=plan,
        )
    diagnostics = diagnostic_output.getvalue()
    if diagnostics:
        print(diagnostics, file=sys.stderr, end="")
    pages = split_pages(outcome.text, PAGE_MARKER)
    payload = {
        **base,
        "content": outcome.text,
        "pages": pages,
        "pagesFromText": outcome.pages_from_text,
        "pagesFromVision": outcome.pages_from_vision,
        "pagesMissing": outcome.pages_missing,
        "visionCalls": outcome.vision_calls,
        "extractorError": outcome.error or None,
        "durationMs": round((time.perf_counter() - started) * 1000),
    }
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
