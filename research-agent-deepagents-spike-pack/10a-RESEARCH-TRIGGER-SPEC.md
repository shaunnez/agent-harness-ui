# Unpriced issues → research trigger set

Built 22 September 2026 from the plancheck database (local Docker, port 5433).
Dataset: `unpriced-issues.json`, 629 items. Extraction SQL: `extract.sql`.

## What "unpriced" means here

`construction_pricing_results.state = 'unmatched'` with `reason = 'no_match'`:
the pricing run completed, and no scenario in the 120-scenario QV catalogue
covered the claim. Latest register per tender, latest succeeded pricing job per
register. Excluded: `failed` (catalogue missing — an ops fault, not a gap),
`refuted` / `check_not_supported` / `corpus_*` (the claim itself is in doubt).

## The population

| | |
|---|---:|
| Unpriced issues | 629 |
| Tenders | 8 |
| Accounts | 2 (James Kirkpatrick Group, Q Group) |
| Catalogue scenarios that exist today | 120 |
| Claims priced across all 8 tenders | 22 |

Largest: L'Oréal 243, QCC19 107, Puhinui 101, QCC76 53, QCC81 52, QCC70 38,
Cain Road 25, Ascot/Kirkbride 10.

By claim type — two types are 72% of everything:

| claim_type | n |
|---|---:|
| deferred_selection | 267 |
| deferred_dimension_or_parameter | 187 |
| referenced_artefact_not_supplied | 68 |
| interface_without_counterparty_or_artefact | 43 |
| (none) | 32 |
| document_not_issued_for_tender | 19 |
| other (4 types) | 13 |

## The finding that shapes the whole design

**Most of these cannot be answered by research, and should not be.** Read three:

- *"Channel drain extents on A040/C3, shown as TBC with civil levels"*
- *"MBUS connected water meters to be confirmed on E-C3-701"*
- *"Fire interface counterparty not defined for the fire hold open device"*

No public source knows this project's answer. Asking a research agent to resolve
the deferral is asking it to invent one.

What research *can* establish is what this **class** of deferral costs when it
moves. Which means **the unit of research output is a scenario, not a claim.**
A scenario for "channel drain, additional linear metres, Auckland" prices
CR-011 and every sibling across all eight tenders. 629 claims plausibly collapse
to a few dozen scenario gaps — that number is a hypothesis, and clustering them
is the first real task.

## The return structure

It has to slot into what already exists, so it mirrors
`construction_catalogue_releases.content.scenarios[]` plus the
`construction_pricing_results.estimate` fields, with one addition.

```jsonc
{
  "covers": ["CR-011", "CR-026"],        // claim ids this scenario would price
  "proposal": {                           // → catalogue scenarios[]
    "title": "Channel drain extension",
    "scope": "Additional precast channel drain, grate and connection in an open
              hardstand area, Auckland.",
    "family": "drainage",
    "quantities": [{
      "key": "drain_run", "unit": "m", "label": "Channel drain",
      "default": {"low": 5.0, "high": 25.0},
      "assumption": "Work allowance, not a measured project quantity."
    }],
    "components": [{
      "key": "channel_drain", "label": "Supply and lay channel drain",
      "effect": "addition", "factor": 1.0,
      "rate_key": "channel_drain_laid", "quantity_key": "drain_run"
    }],
    "exclusions": ["GST, preliminaries, delay/disruption.", "..."]
  },
  "rates": [{                             // → catalogue rates
    "rate_key": "channel_drain_laid", "unit": "m",
    "amount": {"low": 210.0, "high": 340.0},
    "currency": "NZD", "gst_basis": "excl", "centre": "Auckland",
    "as_of": "2026-09-22",
    "source": {
      "url": "...", "publisher": "...", "locator": "table 3 row 12",
      "publication_date": "...", "effective_date": "...",
      "snapshot_sha256": "..."
    }
  }],
  "not_established": [                    // ← the new field
    "No Auckland-specific rate found; figure is a national average.",
    "Grate loading class not established; assumed Class B."
  ],
  "review": {"state": "pending"}
}
```

`not_established` is the field that makes a bad answer worth keeping. An output
that resolves nothing but names four things nobody can source is a real result:
it tells a QS where to spend their own time, and it is the honest alternative to
a confident wrong rate.

## Why the fields are what they are

Every field above already exists on the pricing path, so a reviewer-approved
research output becomes a catalogue scenario with no schema work. Provenance
(`url`, `publisher`, `locator`, dates, `snapshot_sha256`) mirrors what QV
CostBuilder rows already carry — without it a rate cannot be audited later, and
the reviewer is the only thing standing between a scraped number and a client
price.

`centre`, `gst_basis`, `as_of` and `effective_date` are the disqualifiers. A
reviewer should be able to reject on those four before reading the prose.

## Next

1. **Cluster the 629 into candidate scenarios.** One model pass over claim +
   trigger + claim_type. Output: scenario gap list with claim counts. Cheap, and
   it tells you whether the real number is 30 or 300.
2. Run research on the largest 10–20 gaps.
3. Sit with a QS over the raw output and record what kills each one.

Step 1 answers whether this is worth doing at all.
