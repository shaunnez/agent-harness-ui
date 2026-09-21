"""Check the local QV capture before ever touching the web."""
import json, re, math, collections, sys
from concurrent.futures import ThreadPoolExecutor
import anthropic

IDX = "/Users/shaun/plancheck-sets/qv_costbuilder/2026-09-09/normalised-v2/indexed-items.jsonl"
rows = []
for l in open(IDX):
    o = json.loads(l)
    if not o.get("regional_values"): continue
    rows.append({
        "id": o["id"],
        "desc": o.get("description") or "",
        "section": " / ".join(h["text"] for h in (o.get("headings") or [])),
        "unit": o.get("unit_normalised"),
        "akl": (o["regional_values"].get("Auckland") or {}).get("scalar"),
        "wlg": (o["regional_values"].get("Wellington") or {}).get("scalar"),
        "chc": (o["regional_values"].get("Christchurch") or {}).get("scalar"),
        "kind": o.get("kind"),
    })

def toks(s): return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if len(t) > 2]
df = collections.Counter()
docs = []
for r in rows:
    t = set(toks(r["desc"] + " " + r["section"]))
    docs.append(t)
    for x in t: df[x] += 1
N = len(rows)
idf = {t: math.log(1 + N / (1 + c)) for t, c in df.items()}

def retrieve(q, k=45):
    qt = toks(q)
    sc = []
    for i, d in enumerate(docs):
        s = sum(idf.get(t, 0) for t in qt if t in d)
        if s: sc.append((s, i))
    sc.sort(reverse=True)
    return [rows[i] for _, i in sc[:k]]

client = anthropic.Anthropic()
SYS = """You are a New Zealand quantity surveyor.

You are given ONE work scenario our pricing catalogue cannot price, and a shortlist
of candidate rate rows retrieved from our licensed QV CostBuilder capture. The rows
are real QV published rates with six-centre pricing. They are UNREVIEWED: nobody has
confirmed the unit convention or what the rate includes.

Decide whether these rows are enough to build the scenario.

For each row you would use, give its id, what role it plays, and any caveat a
reviewer must settle (unit convention, whether it is supply-only, size/grade
mismatch, whether an aggregate row double-counts its own components).

Then give a verdict:
  "sufficient"  - the scenario can be built from these rows alone
  "needs_more_qv" - QV clearly carries what is missing but this shortlist did not
                    surface it; say what to search the capture for
  "needs_outside" - the missing piece is not measured work QV would publish; say
                    what it is and whether it is web-researchable or quote-only

Never invent a price. Only cite row ids present in the shortlist.

Reply with ONE JSON object in a ```json fence:
{"id":"<scenario id>","verdict":"sufficient|needs_more_qv|needs_outside",
 "rows":[{"row_id":"...","role":"...","caveat":"..."}],
 "missing":"...","search_capture_for":"...","note":"..."}
No prose."""

def one(s):
    q = f"{s['title']} {s['scope']} {s.get('research_need','')}"
    cand = retrieve(q)
    msg = (f"SCENARIO\nid: {s['id']}\ntitle: {s['title']}\nscope: {s['scope']}\n"
           f"family: {s['family']}\nunit: {s['unit']}\n\n"
           f"CANDIDATE QV ROWS (id | section | description | unit | Auckland | Wellington | Christchurch)\n"
           + "\n".join(f"{r['id']} | {r['section']} | {r['desc']} | {r['unit']} | "
                       f"{r['akl']} | {r['wlg']} | {r['chc']}" for r in cand))
    with client.messages.stream(model="claude-opus-5", max_tokens=12000,
        thinking={"type": "adaptive"}, system=SYS,
        messages=[{"role": "user", "content": msg}]) as st:
        r = st.get_final_message()
    t = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    m = re.search(r"```json\s*(.*?)```", t, re.S)
    try: out = json.loads(m.group(1) if m else t)
    except Exception as e: out = {"id": s["id"], "verdict": "ERROR", "note": str(e)}
    out["title"] = s["title"]; out["claim_count"] = s["claim_count"]
    return out, r.usage.input_tokens, r.usage.output_tokens

gaps = json.load(open("/tmp/claude-502/unpriced/research-batch-1.json"))
n = int(sys.argv[1]) if len(sys.argv) > 1 else 12
gaps = gaps[:n]
print(f"index: {len(rows)} priced QV rows")
with ThreadPoolExecutor(max_workers=6) as ex: res = list(ex.map(one, gaps))
outs = [r[0] for r in res]
ti = sum(r[1] for r in res); to = sum(r[2] for r in res)
json.dump(outs, open("/tmp/claude-502/unpriced/research/qvfirst.json", "w"), indent=1)
v = collections.Counter(o["verdict"] for o in outs)
print(f"{len(outs)} scenarios  ~${ti/1e6*5+to/1e6*25:.2f}")
for k, c in v.most_common(): print(f"  {k:15} {c}")
