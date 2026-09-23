"""Independent, synthetic PostgreSQL acceptance for the candidate replay."""

import json
import os
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text

from backend.platform import database
from backend.registers import repository as registers
from backend.variation_costs import construction_repository as jobs
from backend.variation_costs import repository, service, worker
from backend.variation_costs.errors import VariationConflict
from backend.variation_costs.models import SaveVariationLink
from backend.variation_costs.scenario_models import CatalogueImport
from backend.variation_costs.scenarios import canonical_sha, match_claim


ROOT = Path(os.environ["P317_CANDIDATE_ROOT"])
DB_URL = os.environ["PLANCHECK_TEST_DATABASE_URL"]


def candidate_ids(candidates):
    return [
        item if isinstance(item, str)
        else item["scenario_id"] if isinstance(item, dict)
        else item.scenario_id
        for item in candidates
    ]


@pytest.fixture
def case(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", DB_URL)
    monkeypatch.setenv("PLANCHECK_REMEDY_REFRESH_ENABLED", "1")
    monkeypatch.setattr(database, "_DB_AVAILABLE", False)
    monkeypatch.delattr(database.bootstrap, "_engine", raising=False)
    assert database.bootstrap()
    engine = database.require_engine("p317_checker")
    account = str(uuid4())
    with engine.begin() as conn:
        conn.execute(
            text(
                "INSERT INTO accounts(id, name) VALUES (CAST(:id AS uuid), 'P317 checker')"
            ),
            {"id": account},
        )
        tender = conn.execute(
            text(
                "INSERT INTO tenders(account_id, name, phase) VALUES (CAST(:account AS uuid), 'P317 synthetic', 'active') RETURNING id"
            ),
            {"account": account},
        ).scalar_one()
    try:
        content = CatalogueImport.model_validate_json(
            (ROOT / "tests/fixtures/construction_catalogue.json").read_text()
        )
        catalogue = jobs.import_catalogue(content, account_id=account)
        document = json.loads((ROOT / "tests/fixtures/p317-synthetic-register.json").read_text())
        for claim in document["claims"][:2]:
            claim["claim"] = "Hardfill excavation quantity is undefined."
            claim["verification"] = "UNVERIFIED"
        document["claims"][1]["evidence"] = document["claims"][0]["evidence"]
        document["claims"][2]["claim"] = "Contract particulars are incomplete."
        register = registers.store_register(
            document=document,
            origin="upload",
            label="P317 synthetic",
            detection_run_id=None,
            tender_id=tender,
            account_id=account,
            stored_by=None,
            stored_by_name=None,
        )
        yield {
            "engine": engine,
            "account": account,
            "tender": tender,
            "catalogue": catalogue,
            "content": content,
            "document": document,
            "register": register,
        }
    finally:
        with engine.begin() as conn:
            conn.execute(
                text("DELETE FROM accounts WHERE id = CAST(:id AS uuid)"),
                {"id": account},
            )


def test_ambiguous_candidates_survive_storage_and_need_explicit_selection(case):
    f = case
    content = f["content"].model_dump(mode="json")
    alternative = dict(content["scenarios"][0])
    alternative.update(id="other-ground", title="Other ground scope")
    content["scenarios"].append(alternative)
    with f["engine"].begin() as conn:
        conn.execute(
            text(
                "UPDATE construction_catalogues SET content = CAST(:content AS jsonb), content_sha256 = :sha WHERE id = :id"
            ),
            {
                "content": json.dumps(content),
                "sha": canonical_sha(content),
                "id": f["catalogue"],
            },
        )
    before = service.register_costs(f["register"]["id"], account_id=f["account"])
    assert before.summary.amount is None
    assert worker.poll_once()
    after = service.register_costs(f["register"]["id"], account_id=f["account"])
    affected = after.claims[:2]
    assert after.summary.amount is None
    assert after.summary.priced_claims == 0
    assert after.summary.needs_review == 2
    assert all(c.availability == "needs_review" and c.amount is None for c in affected)
    assert all(candidate_ids(c.candidates) == ["ground", "other-ground"] for c in affected)
    with f["engine"].begin() as conn:
        stored = (
            conn.execute(
                text(
                    "SELECT claim_id, to_jsonb(result) AS payload "
                    "FROM construction_pricing_results AS result "
                    "WHERE job_id = :job ORDER BY claim_id"
                ),
                {"job": after.pricing.id},
            )
            .mappings()
            .all()
        )
    expected = {
        f["document"]["claims"][0]["id"]: ["ground", "other-ground"],
        f["document"]["claims"][1]["id"]: ["ground", "other-ground"],
        f["document"]["claims"][2]["id"]: [],
    }
    assert {row["claim_id"] for row in stored} == set(expected)
    for row in stored:
        retained = [
            candidate_ids(value)
            for key, value in row["payload"].items()
            if "candidate" in key.lower() and isinstance(value, list)
        ]
        assert expected[row["claim_id"]] in retained

    claim_id = f["document"]["claims"][0]["id"]
    request = SaveVariationLink(
        expected_revision=0,
        register_sha256=f["register"]["document_sha256"],
        tender_id=f["tender"],
        state="proposed",
        catalogue_id=f["catalogue"],
        scenario_id="ground",
        scenario_inputs={},
        selected_scope="Reviewer chose ground scope",
    )
    repository.save_link(
        f["register"]["id"], claim_id, request, account_id=f["account"], user_id=1
    )
    selected = service.register_costs(f["register"]["id"], account_id=f["account"])
    chosen = next(c for c in selected.claims if c.claim_id == claim_id)
    assert chosen.link.revision == 1
    assert chosen.estimate.origin == "user"
    assert chosen.amount is not None
    assert selected.summary.amount is not None
    assert selected.summary.priced_claims == 1
    with pytest.raises(VariationConflict):
        repository.save_link(
            f["register"]["id"], claim_id, request, account_id=f["account"], user_id=1
        )


def test_incompatible_scope_retains_refused_scenario_id(case):
    catalogue = case["content"]
    refused = match_claim(
        {"claim": "Contaminated hardfill excavation quantity is undefined."},
        catalogue,
    )
    assert refused.state == "incompatible"
    refused_ids = candidate_ids(getattr(refused, "refused", ()))
    assert "ground" in candidate_ids(refused.candidates) + refused_ids
