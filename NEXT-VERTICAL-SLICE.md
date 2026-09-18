# Next Vertical Slice: One Useful Research Agent

## Recommendation

The next PR should make the current Deep Agents runtime do one genuinely useful research task.

Do not add subagents yet.

Do not add Qwen yet.

Do not build RAG yet.

Do not add another architecture layer.

The goal is to go from:

```text
objective
   |
   v
model
   |
   v
synthetic finding
```

to:

```text
objective
   |
   v
web search
   |
   v
source fetch
   |
   v
retained snapshot
   |
   v
evidence-linked finding
   |
   v
structured result
```

This is the first point where the research runtime becomes visibly useful.

---

# 1. Demo Goal

We should be able to submit:

> Find current New Zealand suppliers and public pricing for a specified waterproofing product or system. Find the manufacturer's installation requirements. Return structured findings with evidence, retrieval dates and exact supporting excerpts.

And receive something like:

```json
{
  "summary": "...",
  "findings": [
    {
      "claim": "Supplier X lists Product Y at NZD ...",
      "evidence": [
        {
          "sourceId": "source-1",
          "url": "...",
          "retrievedAt": "...",
          "excerpt": "...",
          "quoteVerified": true
        }
      ]
    }
  ]
}
```

This does not have to be production-grade construction research yet.

It must prove the complete evidence path.

---

# 2. Scope

Add exactly four capabilities.

## A. `web_search(query)`

Purpose:

Discover candidate sources.

Requirements:

1. Returns title, URL and short snippet/metadata.
2. Search provider is adapter/tool configuration, not hard-coded into the neutral domain model.
3. Count every search against `maxSearchCalls`.
4. Search calls also count toward aggregate `maxToolCalls`.
5. Search results are discovery evidence only, not automatically trusted as claims.

For the first spike, use one provider only.

Prefer whichever provider is easiest and inexpensive.

Potential choices include Exa, Tavily, Firecrawl search or another approved search API.

Do not implement a search-provider abstraction framework unless needed.

---

## B. `fetch_source(url)`

Purpose:

Fetch the actual source the model wants to rely on.

Requirements:

1. Host performs the fetch.
2. Validate URL/scheme.
3. Apply response-size ceiling.
4. Apply timeout.
5. Record retrieval timestamp.
6. Record media type.
7. Store normalized textual content.
8. Create an immutable/content-addressed snapshot reference.
9. Calculate SHA-256.
10. Return only the bounded source representation to the model.

For the first vertical slice, HTML/text sources are sufficient.

PDF/browser-heavy handling can come later.

---

## C. Host-owned source snapshot

The model must not be the system of record for evidence content.

Store:

```text
source id
run id
URL
title
retrieved_at
content_sha256
content bytes or retained artifact reference
media type
```

Use the existing run-scoped source identity.

The canonical content can initially be stored directly if bounded and simple, or as an artifact/file with a content reference.

Choose the smallest implementation consistent with the existing architecture.

---

## D. Evidence-linked `submit_finding`

Change `submit_finding` so useful findings must reference retained sources.

Example tool input:

```json
{
  "claim": "The manufacturer requires two coats.",
  "evidence": [
    {
      "sourceId": "source-1",
      "excerpt": "Apply two coats...",
      "locator": {
        "section": "Application"
      }
    }
  ],
  "confidence": 0.9,
  "assumptions": []
}
```

The host must verify:

1. Source belongs to the same run.
2. Source snapshot exists.
3. Excerpt is a literal substring of retained normalized content.
4. If valid, host records `quoteVerified: true`.
5. If invalid, reject the tool call.

The model must never set `quoteVerified`.

---

# 3. Security Requirements

This is a web-connected agent, so the security posture changes.

Required:

1. Fetch/search tools are host-owned.
2. Model does not receive unrestricted HTTP access.
3. Model does not receive shell access.
4. Model does not receive host filesystem access through tools.
5. URL scheme allowlist: HTTP/HTTPS only.
6. Reject loopback/private-network destinations unless deliberately required.
7. Apply DNS/IP checks where appropriate to reduce SSRF risk.
8. Response byte limits.
9. Request timeout.
10. Content-type handling.
11. Treat fetched content as hostile/untrusted.
12. Never execute scripts from fetched pages.
13. Never allow fetched content to redefine tool permissions.
14. Keep the existing isolated child environment.

Do not add browser automation yet.

---

# 4. Budget Enforcement

This slice makes several ceilings real.

## Hard

1. `maxSearchCalls`.
2. `maxToolCalls`.
3. `maxModelCalls`.
4. `maxRuntimeMs`.

Use a true aggregate tool-call ceiling.

Do not implement one `maxToolCalls` ceiling per tool.

## Observed

Record:

1. Search calls.
2. Fetch calls.
3. Model calls.
4. Input tokens.
5. Output tokens.
6. Wall-clock duration.
7. Search provider cost if known.
8. Model estimated cost if rate card exists.

---

# 5. Research Prompt

Keep the agent deliberately simple.

It should be told:

1. Understand the objective.
2. Search for relevant primary/authoritative sources.
3. Prefer manufacturer/supplier/official sources.
4. Fetch sources before making factual claims.
5. Submit findings with exact supporting excerpts.
6. Surface uncertainty.
7. Surface conflicting evidence.
8. Stop when enough evidence exists or a budget ceiling is reached.
9. Never invent a price or specification.
10. Use public web information only for this demo.

No planner/subagent decomposition yet.

---

# 6. Suggested First Demo

Use a narrow construction question.

Example:

> Research Sika waterproofing membrane products currently available in New Zealand. Identify at least two NZ suppliers with public pricing where available, and find the manufacturer's installation/application requirements for the most relevant product. Return sourced findings only. If pricing is not publicly available, state that rather than guessing.

Why this is a good demo:

1. It has identifiable manufacturers.
2. It has NZ supplier context.
3. It has product specifications.
4. It may contain public pricing.
5. It creates multiple source types.
6. We can manually verify it easily.

---

# 7. Expected UI/API Behaviour

No major UI build is needed yet.

The existing research API should be sufficient.

We need to be able to inspect:

1. Run status.
2. Events.
3. Sources.
4. Result.
5. Usage.

Optionally add a tiny developer command/script such as:

```bash
npm run research:demo
```

which:

1. Starts or targets the local companion.
2. Submits the demo request using runtime `deepagents`.
3. Polls until terminal.
4. Prints events.
5. Prints sources.
6. Prints findings.
7. Prints usage and duration.

This would make the feature tangible without building UI.

I strongly recommend this script.

---

# 8. Tests

Add deterministic tests for:

1. Search-call ceiling.
2. Aggregate tool-call ceiling.
3. Fetch timeout.
4. Oversized response.
5. Unsupported URL scheme.
6. Private/loopback URL rejection.
7. Source snapshot persistence.
8. SHA-256 stability.
9. Evidence excerpt accepted when it matches.
10. Evidence excerpt rejected when it does not match.
11. Cross-run source reference rejected.
12. Model cannot set `quoteVerified`.
13. Run completes with evidence-linked finding.
14. Search/fetch error produces explainable failure/partial result.
15. Existing research/runtime tests remain green.
16. Existing SDLC tests remain green.

Use local fake HTTP/search fixtures for CI.

One opt-in live search test is acceptable, but the main suite must not depend on internet access.

---

# 9. Deliverable

Create:

`RESEARCH-RUNTIME-VERTICAL-SLICE.md`

Include:

1. Search provider chosen and why.
2. Tool contracts.
3. Fetch security boundary.
4. Source snapshot format.
5. Evidence verification flow.
6. Budget accounting.
7. Demo command.
8. Demo output.
9. Test results.
10. Cost/time for the live demo.
11. Limitations.
12. Exact next seam for bounded subagents.

---

# 10. Acceptance Criteria

The slice is successful when one command can run:

```text
real model
  +
real web search
  +
real source fetch
  +
host-retained source evidence
  +
verified excerpts
  +
structured findings
```

and produce a result a human can manually inspect.

The important acceptance test is not whether Deep Agents can orchestrate.

That is already proven.

The important test is:

> Does this produce useful, defensible research?

---

# 11. What Comes Immediately After

If this vertical slice works:

## Next

Add bounded 3-researcher fan-out.

Example roles:

1. Manufacturer/spec researcher.
2. Supplier/pricing researcher.
3. Standards/alternative-products researcher.

Then fan-in and synthesise.

## After that

Route cheap Qwen/private workers into those researcher roles.

Then compare:

```text
Current PlanCheck
vs
Deep Agents + frontier model
vs
Deep Agents + cheap workers
vs
Hybrid cheap workers + frontier verifier
```

Do not add parallel agents until the one-agent evidence loop is proven useful.
