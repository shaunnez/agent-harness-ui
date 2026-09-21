import json, os, re, sys, datetime
from concurrent.futures import ThreadPoolExecutor
import anthropic

TODAY = datetime.date.today().isoformat()
MODEL = "claude-opus-5"
client = anthropic.Anthropic()

SYSTEM = f"""You are a New Zealand quantity surveyor. Today is {TODAY}.

Our construction variation rate catalogue does not cover the scenario given to you.
Your job is to establish a defensible NZD cost band for that class of work from
PUBLIC sources, or to state honestly that it cannot be established.

You have web search. You decide what to search for. Nobody has written the queries
for you and there is no template.

STEP 1 - is this worth pricing at all?
Some scenarios are deferred selections where no rate moves: a paint colour chosen
late within the same paint system, a tile pattern within the same tile range, a
handle finish within the same range. If the work, the labour and the product family
are unchanged and only an aesthetic choice is outstanding, set "researchable": false,
give the reason, and stop. Do not search. That is a correct answer, not a failure.

STEP 2 - plan. Write down what you are actually looking for and why, in
"search_strategy", BEFORE you search. Name the NZ sources you expect to be useful.

STEP 3 - search and read. Prefer, in order:
  1. Published NZ cost references and indices (Rawlinsons, BRANZ, QV, CoreLogic/Cordell)
  2. NZ supplier and trade price lists, published installed rates
  3. Government, council and agency schedules of rates, published tender results
  4. NZ trade press and industry bodies quoting rates
Distrust: content farms, AI-written "cost guides" with no named author or date,
lead-generation sites, forums, and anything undated.

STEP 4 - price it. Give a low/high band, not a point. The band should reflect the
real spread across specification and region, not a fake confidence interval.

HARD RULES
- NZD, GST EXCLUDED. If a source is GST-inclusive, convert and say so.
- State the centre the rate applies to (e.g. "Auckland", "New Zealand national").
- NEVER invent a rate. If you cannot source it, set the amount null and say why in
  "not_established". An output with no rate and four honest gaps is a real result.
- Do NOT present an Australian, UK or US rate as a New Zealand rate. If you use an
  offshore figure as a sanity check, say so explicitly in "not_established".
- Cite the page that actually carried the number, with a locator (table, row,
  heading, page). Not a site home page.
- Prefer sources dated within 24 months. Older is allowed if you say how old and
  note that escalation has not been applied.

"not_established" is the most important field you write. It is what tells a
quantity surveyor where to spend their own time. Be exhaustive and specific in it.

Reply with ONE JSON object in a ```json fence, no prose outside it:

{{
  "id": "<scenario id, echoed>",
  "researchable": true|false,
  "researchable_reason": "<why, especially if false>",
  "search_strategy": "<what you looked for and why, written before searching>",
  "confidence": "high"|"medium"|"low",
  "proposal": {{
    "title": "...", "scope": "...", "family": "...",
    "quantities": [{{"key":"...","unit":"...","label":"...",
                    "default":{{"low":0,"high":0}},"assumption":"..."}}],
    "components": [{{"key":"...","label":"...","effect":"addition",
                    "factor":1.0,"rate_key":"...","quantity_key":"..."}}],
    "exclusions": ["..."]
  }},
  "rates": [{{
    "rate_key":"...", "unit":"...",
    "amount": {{"low": 0.0, "high": 0.0}},
    "currency":"NZD", "gst_basis":"excl", "centre":"...", "as_of":"{TODAY}",
    "basis":"<what this rate includes: supply only / supplied and installed / etc>",
    "source": {{"url":"...","publisher":"...","locator":"...",
               "publication_date":"...","effective_date":"..."}}
  }}],
  "not_established": ["...", "..."]
}}"""

def one(s):
    msg = (f"Scenario id: {s['id']}\n"
           f"Title: {s['title']}\n"
           f"Scope: {s['scope']}\n"
           f"Family: {s['family']}\n"
           f"Catalogue unit: {s['unit']}\n"
           f"What our clustering said still needs establishing: {s.get('research_need','')}\n"
           f"This class appeared {s['claim_count']} times across tenders we could not price.\n\n"
           f"Price it, or tell us why you cannot.")
    try:
        with client.messages.stream(
            model=MODEL, max_tokens=16000,
            thinking={"type": "adaptive"},
            system=SYSTEM,
            tools=[{"type": "web_search_20260209", "name": "web_search", "max_uses": 10}],
            messages=[{"role": "user", "content": msg}],
        ) as st:
            r = st.get_final_message()
    except Exception as e:
        return {"id": s["id"], "error": f"{type(e).__name__}: {e}"}, 0, 0, 0
    txt = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    m = re.search(r"```json\s*(.*?)```", txt, re.S)
    raw = m.group(1) if m else txt
    try:
        out = json.loads(raw)
    except Exception as e:
        out = {"id": s["id"], "error": f"unparseable: {e}", "raw": txt[:4000]}
    u = r.usage
    searches = getattr(getattr(u, "server_tool_use", None), "web_search_requests", 0) or 0
    out["_meta"] = {"searches": searches, "in": u.input_tokens, "out": u.output_tokens,
                    "stop": r.stop_reason}
    return out, u.input_tokens, u.output_tokens, searches

def main():
    batch = json.load(open(sys.argv[1]))
    n = int(sys.argv[2]) if len(sys.argv) > 2 else len(batch)
    batch = batch[:n]
    outpath = sys.argv[3] if len(sys.argv) > 3 else "priced.json"
    with ThreadPoolExecutor(max_workers=5) as ex:
        res = list(ex.map(one, batch))
    outs = [r[0] for r in res]
    ti = sum(r[1] for r in res); to = sum(r[2] for r in res); ts = sum(r[3] for r in res)
    json.dump(outs, open(outpath, "w"), indent=1)
    cost = ti/1e6*5 + to/1e6*25 + ts*0.01
    ok = sum(1 for o in outs if not o.get("error"))
    prc = sum(1 for o in outs if o.get("rates"))
    nr = sum(1 for o in outs if o.get("researchable") is False)
    print(f"{ok}/{len(outs)} parsed | {prc} with rates | {nr} judged not worth researching")
    print(f"searches={ts} in={ti} out={to} ~${cost:.2f}  -> {outpath}")

main()
