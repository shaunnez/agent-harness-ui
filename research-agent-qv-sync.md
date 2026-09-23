# Research agent: timing, QV lookup, and syncing prices to PlanCheck

23 September 2026. Advice only; nothing here is decided or built. Slice A (the backend) does not
depend on it: review stays separate from any publishing step.

## 1. How long a question takes

About **2½–4 minutes** per question.

| | Time | Plan usage |
|---|---|---|
| Claude, three runs in parallel (measured on the channel drain question) | 153 s | about $4–5 |
| Codex, 30 questions × 3 runs, three runs at a time | about 3.3 min per run | nothing billed per call |
| Quick one-run ask | about the same as one run, 2–3 min | about a third |

Three runs don't take three times as long because they run side by side. Most of the time goes on
10–22 QV searches plus a few web fetches.

## 2. How it queries QV cost

It never contacts QV live. It searches a **local file**: the full QV CostBuilder capture from
9 September (9,816 priced rows), at
`~/plancheck-sets/qv_costbuilder/2026-09-09/normalised-v2/indexed-items.jsonl`. The file is set by
the `RESEARCH_QV_INDEX` environment variable.

It has three tools over that file:

- `search_qv`: keyword search;
- `get_qv_table`: the whole table a row belongs to;
- `list_qv_sections`: what the capture covers.

It uses the web only for what QV doesn't publish. After the run, every cited QV row id is checked
against the same file.

**Should it use PlanCheck's catalogue instead? Use both, for different jobs:**

- **The full capture stays the research source.** The PlanCheck catalogue is 145 selected rates, a
  thin slice of the same QV data. Research only starts when the catalogue has no match, so
  searching only the catalogue would find nothing by definition.
- **Add the catalogue as a read-only tool.** The agent could then see which rates are already in
  use and build around them, rather than contradicting them.
- **Cheapest win: a no-model step.** Doc 11 found most gaps are "QV publishes this, we just never
  captured it". A plain lookup against the full capture would promote those rows without any
  research run. Research is left for items QV genuinely lacks.

## 3. Getting prices into PlanCheck quickly

A pull request is too slow for this. The options, recommended first:

1. **A catalogue table in PlanCheck's database, written through a small PlanCheck endpoint
   (recommended).**
   - On approve, the Harness sends one record: rate, unit, band, as-of date, evidence
     fingerprint, approver, source.
   - Sending the same fingerprint twice does no harm; it doesn't create a duplicate.
   - The price is live in seconds.
   - PlanCheck owns the database layout; the Harness only knows the endpoint.
   - The Harness only calls out. PlanCheck never needs to reach the operator's laptop.
2. **The Harness writes straight into PlanCheck's database.** Faster to build, but it ties the
   Harness to PlanCheck's database layout and needs credentials held on the local machine. Avoid.
3. **A CMS both apps can use.** Adds a third system to run and secure. Only worth it if QSs need to
   edit or curate rates by hand outside both apps. The Harness review screen already covers
   approval.

**Safeguards once there's no PR to catch mistakes:**

- Researched rates are marked as researched, separate from QV rates, with the evidence link.
- Automatic approval only when all three runs agreed and every citation checked out.
- A revoke switch that pulls a bad rate back out.
- Requests could come back the same way: PlanCheck lists open requests at an endpoint and the
  Harness checks it. That removes Linear from the loop, though Linear still works if requests
  should be visible there.

**Caveat:** how PlanCheck stores its catalogue today has not been checked; the repository is not
in `~/projects`. The recommendation assumes it has a server-side database.

## Effect on slice A

None beyond what doc 27 already requires: record each question's `source`, reuse a question for a
repeated request, keep the record exportable in the 18a shape with its fingerprint, and keep
approval a separate step so a "publish to PlanCheck" action can be added after it.
