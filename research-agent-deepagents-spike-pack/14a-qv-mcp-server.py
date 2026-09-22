#!/usr/bin/env python3
"""Minimal MCP stdio server exposing the local QV capture. No dependencies."""
import json, sys, re, math, collections

IDX = "/Users/shaun/plancheck-sets/qv_costbuilder/2026-09-09/normalised-v2/indexed-items.jsonl"
ROWS, TABLES = [], collections.defaultdict(list)
for l in open(IDX):
    o = json.loads(l); rv = o.get("regional_values") or {}
    if not rv: continue
    parts = o["id"].rsplit(":", 2)
    r = {"id": o["id"], "desc": o.get("description") or "",
         "section": " / ".join(h["text"] for h in (o.get("headings") or [])),
         "unit": o.get("unit_normalised"),
         "px": {k: (v or {}).get("scalar") for k, v in rv.items()},
         "group": o.get("nearest_group") or "", "flags": o.get("flags") or [], "table": f"{parts[0]}:{parts[1]}"}
    ROWS.append(r); TABLES[r["table"]].append(r)

def toks(s): return [t for t in re.split(r"[^a-z0-9]+", s.lower()) if len(t) > 2]
df = collections.Counter(); DOCS = []
for r in ROWS:
    t = set(toks(r["desc"] + " " + r["section"] + " " + r["group"])); DOCS.append(t)
    for x in t: df[x] += 1
N = len(ROWS); IDF = {t: math.log(1 + N/(1+c)) for t, c in df.items()}

def fmt(r):
    p = r["px"]
    return (f"{r['id']} | {r['section']} | {r['group']} | {r['desc']} | {r['unit']} | "
            f"AKL {p.get('Auckland')} WLG {p.get('Wellington')} CHC {p.get('Christchurch')}"
            + (f" | FLAGS {','.join(r['flags'])}" if r["flags"] else ""))

def search_qv(query, section_contains=None, limit=25):
    qt = toks(query); sc = []
    for i, d in enumerate(DOCS):
        if section_contains and section_contains.lower() not in ROWS[i]["section"].lower(): continue
        s = sum(IDF.get(t, 0) for t in qt if t in d)
        if s: sc.append((s, i))
    sc.sort(reverse=True)
    hit = [ROWS[i] for _, i in sc[:min(int(limit or 25), 60)]]
    return (f"{len(hit)} rows:\n" + "\n".join(map(fmt, hit))) if hit else "No rows matched."

def get_qv_table(row_id):
    p = row_id.rsplit(":", 2)
    key = f"{p[0]}:{p[1]}" if len(p) >= 3 else row_id
    rs = TABLES.get(key)
    return (f"Table {key}, {len(rs)} rows:\n" + "\n".join(map(fmt, rs))) if rs else f"No table {key}."

def list_qv_sections(contains=""):
    c = collections.Counter(r["section"] for r in ROWS if (contains or "").lower() in r["section"].lower())
    return "\n".join(f"{n:5}  {s}" for s, n in c.most_common(60)) or "No sections matched."

TOOLS = [
 {"name": "search_qv", "description": f"Keyword search over {len(ROWS)} priced QV CostBuilder rows from our licensed local capture. Returns row id, section, description, unit and Auckland/Wellington/Christchurch prices. Search this BEFORE the web.",
  "inputSchema": {"type": "object", "properties": {
    "query": {"type": "string"}, "section_contains": {"type": "string"}, "limit": {"type": "integer"}},
   "required": ["query"]}},
 {"name": "get_qv_table", "description": "Return every row of the QV table a row id belongs to, to see siblings, size variants and price tiers.",
  "inputSchema": {"type": "object", "properties": {"row_id": {"type": "string"}}, "required": ["row_id"]}},
 {"name": "list_qv_sections", "description": "List QV section paths with row counts.",
  "inputSchema": {"type": "object", "properties": {"contains": {"type": "string"}}}},
]
FN = {"search_qv": search_qv, "get_qv_table": get_qv_table, "list_qv_sections": list_qv_sections}

def send(o): sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
for line in sys.stdin:
    line = line.strip()
    if not line: continue
    try: req = json.loads(line)
    except Exception: continue
    m, rid = req.get("method"), req.get("id")
    if m == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {"protocolVersion": "2024-11-05",
             "capabilities": {"tools": {}}, "serverInfo": {"name": "qv", "version": "1"}}})
    elif m == "tools/list":
        send({"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS}})
    elif m == "tools/call":
        p = req.get("params") or {}
        try: out = FN[p["name"]](**(p.get("arguments") or {}))
        except Exception as e: out = f"tool error: {type(e).__name__}: {e}"
        send({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": str(out)[:60000]}]}})
    elif rid is not None:
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
