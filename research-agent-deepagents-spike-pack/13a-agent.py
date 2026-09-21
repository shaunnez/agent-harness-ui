"""A research agent that searches what we own before it searches the web."""
import json, re, math, collections, sys, threading
from concurrent.futures import ThreadPoolExecutor
import anthropic

IDX = "/Users/shaun/plancheck-sets/qv_costbuilder/2026-09-09/normalised-v2/indexed-items.jsonl"
ROWS, TABLES = [], collections.defaultdict(list)
for l in open(IDX):
    o = json.loads(l)
    rv = o.get("regional_values") or {}
    if not rv: continue
    doc, tbl = o["id"].rsplit(":", 2)[0], o["id"].rsplit(":", 2)[1]
    r = {"id": o["id"], "desc": o.get("description") or "",
         "section": " / ".join(h["text"] for h in (o.get("headings") or [])),
         "unit": o.get("unit_normalised"),
         "px": {k: (v or {}).get("scalar") for k, v in rv.items()},
         "group": o.get("nearest_group") or "", "flags": o.get("flags") or [], "table": f"{doc}:{tbl}"}
    ROWS.append(r); TABLES[r["table"]].append(r)

def toks(s): return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if len(t) > 2]
df = collections.Counter(); DOCS = []
for r in ROWS:
    t = set(toks(r["desc"] + " " + r["section"] + " " + r["group"])); DOCS.append(t)
    for x in t: df[x] += 1
N = len(ROWS)
IDF = {t: math.log(1 + N / (1 + c)) for t, c in df.items()}

def fmt(r):
    p = r["px"]
    return (f"{r['id']} | {r['section']} | {r['group']} | {r['desc']} | {r['unit']} | "
            f"AKL {p.get('Auckland')} WLG {p.get('Wellington')} CHC {p.get('Christchurch')}"
            + (f" | FLAGS {','.join(r['flags'])}" if r["flags"] else ""))

def search_qv(query, section_contains=None, limit=25):
    qt = toks(query); sc = []
    for i, d in enumerate(DOCS):
        if section_contains and section_contains.lower() not in ROWS[i]["section"].lower():
            continue
        s = sum(IDF.get(t, 0) for t in qt if t in d)
        if s: sc.append((s, i))
    sc.sort(reverse=True)
    hit = [ROWS[i] for _, i in sc[:min(int(limit), 60)]]
    if not hit: return "No rows matched. Try fewer or different words, or drop section_contains."
    return f"{len(hit)} rows:\n" + "\n".join(fmt(r) for r in hit)

def get_qv_table(row_id):
    key = row_id.rsplit(":", 2)[0] + ":" + row_id.rsplit(":", 2)[1] if row_id.count(":") >= 2 else row_id
    rs = TABLES.get(key)
    if not rs: return f"No table {key}. Pass a full row id like <hash>:t14:r35."
    return f"Table {key}, {len(rs)} rows:\n" + "\n".join(fmt(r) for r in rs)

def list_qv_sections(contains=""):
    c = collections.Counter(r["section"] for r in ROWS if contains.lower() in r["section"].lower())
    if not c: return "No sections matched."
    return "\n".join(f"{n:5}  {s}" for s, n in c.most_common(60))

TOOLS = [
 {"name": "search_qv", "description":
  "Keyword search over 9,816 priced QV CostBuilder rows captured from our licensed "
  "subscription. Returns row id, section path, description, unit and prices for "
  "Auckland, Wellington and Christchurch. Search this BEFORE the web.",
  "input_schema": {"type": "object", "properties": {
    "query": {"type": "string", "description": "Trade words, e.g. 'submain cable XLPE'"},
    "section_contains": {"type": "string", "description": "Optional section filter, e.g. 'Electrical'"},
    "limit": {"type": "integer", "description": "Max rows, up to 60. Default 25."}},
   "required": ["query"]}},
 {"name": "get_qv_table", "description":
  "Return EVERY row of the QV table a row id belongs to. Use after search_qv finds "
  "one good row, to see its siblings, size variants and tiers.",
  "input_schema": {"type": "object", "properties": {
    "row_id": {"type": "string", "description": "A full row id from search_qv"}},
   "required": ["row_id"]}},
 {"name": "list_qv_sections", "description":
  "List QV section paths with row counts, to find out what the capture covers.",
  "input_schema": {"type": "object", "properties": {
    "contains": {"type": "string", "description": "Optional substring filter"}}}},
 {"type": "web_search_20260209", "name": "web_search", "max_uses": 8},
]
LOCAL = {"search_qv": search_qv, "get_qv_table": get_qv_table, "list_qv_sections": list_qv_sections}

SYS = """You are a New Zealand quantity surveyor with a research budget.

A scenario is given that our pricing catalogue cannot price. Establish what it costs.

ORDER OF RESORT - follow it strictly:
1. search_qv FIRST, always. We pay for QV CostBuilder and 9,816 priced rows are
   indexed locally. Search it properly: try trade synonyms, use list_qv_sections to
   see what exists, and when you find a good row call get_qv_table to see its whole
   table. Most work is in there. Keep searching QV until you are satisfied it does
   not have the item - several queries, not one.
2. Only then web_search, and only for what QV would never publish: proprietary or
   vendor equipment, network and lines-company charges, statutory fees, consultant
   fees, specialist subcontract packages.
3. If nothing is published anywhere, say so and name the NZ suppliers to ring.

QV rows are UNREVIEWED. Nobody has confirmed the unit convention or what a rate
includes. Cite row ids, state your caveats, and never present a row as a settled
price. Never combine an aggregate row with its own components. Never invent a number.
GST exclusive, NZD, name the centre.

Finish with ONE JSON object in a ```json fence:
{"id":"...","resolved_from":"qv|qv+web|web|supplier_quote|not_established",
 "confidence":"high|medium|low",
 "components":[{"role":"...","row_id":"<id or null>","source":"<url if web>",
                "unit":"...","amount":{"low":0,"high":0},"centre":"...","caveat":"..."}],
 "band":{"unit":"...","low":0,"high":0,"centre":"...","basis":"<what it includes>"},
 "not_established":["..."],
 "suppliers_to_ring":["..."],
 "qv_queries_tried":["..."]}
Set band amounts to null if you could not establish one. That is a real answer."""

client = anthropic.Anthropic()
lock = threading.Lock()

def run(s):
    msgs = [{"role": "user", "content":
        f"SCENARIO\nid: {s['id']}\ntitle: {s['title']}\nscope: {s['scope']}\n"
        f"family: {s['family']}\ncatalogue unit: {s['unit']}\n"
        f"still to establish: {s.get('research_need','')}\n"
        f"appeared {s['claim_count']} times in tenders we could not price.\n\n"
        f"Price it, or tell us honestly why you cannot."}]
    ti = to = ws = 0; turns = 0
    while turns < 18:
        turns += 1
        with client.messages.stream(model="claude-opus-5", max_tokens=12000,
            thinking={"type": "adaptive"}, system=SYS, tools=TOOLS,
            messages=msgs) as st:
            r = st.get_final_message()
        ti += r.usage.input_tokens; to += r.usage.output_tokens
        ws += getattr(getattr(r.usage, "server_tool_use", None), "web_search_requests", 0) or 0
        msgs.append({"role": "assistant", "content": r.content})
        calls = [b for b in r.content if getattr(b, "type", "") == "tool_use" and b.name in LOCAL]
        if not calls: break
        res = []
        for b in calls:
            try: out = LOCAL[b.name](**b.input)
            except Exception as e: out = f"tool error: {type(e).__name__}: {e}"
            res.append({"type": "tool_result", "tool_use_id": b.id, "content": str(out)[:60000]})
        msgs.append({"role": "user", "content": res})
    txt = "".join(b.text for b in r.content if getattr(b, "type", "") == "text")
    m = re.search(r"```json\s*(.*?)```", txt, re.S)
    try: out = json.loads(m.group(1) if m else txt)
    except Exception as e: out = {"id": s["id"], "resolved_from": "PARSE_ERROR", "err": str(e)}
    out["title"] = s["title"]; out["claim_count"] = s["claim_count"]
    out["_meta"] = {"turns": turns, "web_searches": ws, "in": ti, "out": to}
    with lock: print(f"  done {s['id']}  turns={turns} web={ws}", flush=True)
    return out, ti, to, ws

gaps = json.load(open("/tmp/claude-502/unpriced/research-batch-1.json"))[:int(sys.argv[1])]
print(f"QV index: {len(ROWS)} priced rows in {len(TABLES)} tables")
with ThreadPoolExecutor(max_workers=6) as ex: res = list(ex.map(run, gaps))
outs = [x[0] for x in res]
ti = sum(x[1] for x in res); to = sum(x[2] for x in res); ws = sum(x[3] for x in res)
json.dump(outs, open("/tmp/claude-502/unpriced/research/agent-results.json", "w"), indent=1)
c = collections.Counter(o["resolved_from"] for o in outs)
banded = sum(1 for o in outs if (o.get("band") or {}).get("low") is not None)
print(f"\n{len(outs)} scenarios | {banded} with a cost band | web searches {ws}")
for k, v in c.most_common(): print(f"  {k:16} {v}")
print(f"~${ti/1e6*5 + to/1e6*25 + ws*0.01:.2f}")
