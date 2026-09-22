"""Turn raw agent runs into one review-ready record per scenario."""
import json, re, glob, os, statistics as st, datetime, hashlib

ROWMAP = json.load(open("qv-rowmap.json"))
CLAIMS = {s["id"]: s for s in json.load(open("../research-batch-1.json"))}
TODAY = datetime.date.today().isoformat()

ALIAS = {"ceiling":"suspended-ceiling-tile-grid","cable":"mains-and-feeder-cable-install",
 "doorset":"internal-doorset-supply-install","retaining-wall":"retaining-wall-construction",
 "solar":"solar-mounting-structural-design","channel-drain":"channel-drain-installation"}

def load():
    g={}
    for f in sorted(glob.glob("out30/*__r*.json"))+sorted(glob.glob("pin5/*__r*.json"))+sorted(glob.glob("pinned/run*.json")):
        if os.path.getsize(f)==0: continue
        if "pinned/run" in f: s,run="channel-drain",os.path.basename(f)[:-5]
        else:
            b=os.path.basename(f)[:-5].split("__"); s=b[0].replace("p-","",1); run=b[-1]
        try: d=json.load(open(f))
        except Exception: continue
        m=re.search(r"```json\s*(.*?)```", d.get("result") or "", re.S)
        try: o=json.loads(m.group(1)) if m else {}
        except Exception: o={}
        g.setdefault(s,[]).append((run,o,d))
    return g

def scenario_meta(key):
    cid=ALIAS.get(key,key)
    for k,v in CLAIMS.items():
        if k==cid or k.replace("-","")==cid.replace("-",""): return k,v
    # fuzzy
    for k,v in CLAIMS.items():
        if cid.replace("-","")[:14] in k.replace("-",""): return k,v
    return cid,{}

out=[]
for key,runs in sorted(load().items()):
    cid,meta=scenario_meta(key)
    scope_file=None
    for p in (f"scen30/{cid}.txt", f"scen/p-{key}.txt", "scen/channel-drain-PINNED.txt"):
        if os.path.exists(p): scope_file=p; break
    scope=open(scope_file).read() if scope_file else None

    banded=[(r,o) for r,o,_ in runs if (o.get("band") or {}).get("low") is not None]
    los=[(o["band"]["low"]) for _,o in banded]; his=[(o["band"]["high"]) for _,o in banded]

    # every QV row any run cited, with its real price and URL
    cited={}
    for _,o,_ in runs:
        for c in (o.get("components") or []):
            rid=c.get("row_id")
            if rid and rid in ROWMAP:
                cited.setdefault(rid,{**ROWMAP[rid],"row_id":rid,"cited_by":0})
                cited[rid]["cited_by"]+=1
    weburls=sorted({c.get("source") for _,o,_ in runs for c in (o.get("components") or [])
                    if c.get("source") and str(c.get("source")).startswith("http")})

    if banded:
        agree_lo=max(los)/min(los); agree_hi=max(his)/min(his)
        status = "agreed" if (agree_lo<=1.25 and agree_hi<=1.35) else "disputed"
        rng={"min":min(los),"max":max(his)}
        cons={"low":round(st.median(los),2),"high":round(st.median(his),2)}
    else:
        agree_lo=agree_hi=None; status="not_established"; rng=cons=None

    rec={
      "scenario_id": cid,
      "title": meta.get("title") or key.replace("-"," ").title(),
      "family": meta.get("family"),
      "unit": (banded[0][1]["band"].get("unit") if banded else meta.get("unit")),
      "claims_covered": meta.get("claim_count"),
      "status": status,
      "range": rng,
      "consensus": cons,
      "agreement": {"low_ratio": round(agree_lo,3) if agree_lo else None,
                    "high_ratio": round(agree_hi,3) if agree_hi else None,
                    "runs_with_band": len(banded), "runs_total": len(runs)},
      "currency": "NZD", "gst_basis": "exclusive",
      "centre": (banded[0][1]["band"].get("centre") if banded else None) or "Auckland",
      "as_of": TODAY,
      "basis": (banded[0][1]["band"].get("basis") if banded else None),
      "pinned_scope": scope,
      "runs": [{"run": r,
                "low": (o.get("band") or {}).get("low"),
                "high": (o.get("band") or {}).get("high"),
                "resolved_from": o.get("resolved_from"),
                "confidence": o.get("confidence"),
                "basis": (o.get("band") or {}).get("basis"),
                "components": o.get("components") or [],
                "not_established": o.get("not_established") or []}
               for r,o,_ in sorted(runs)],
      "qv_sources": sorted(cited.values(), key=lambda x:-x["cited_by"]),
      "web_sources": weburls,
      "open_questions": sorted({n for _,o,_ in runs for n in (o.get("not_established") or [])}),
      "review": {"state":"pending","decision":None,"reviewer":None,"note":None,"decided_at":None},
    }
    rec["record_sha256"]=hashlib.sha256(json.dumps(
        {k:v for k,v in rec.items() if k!="review"},sort_keys=True,default=str).encode()).hexdigest()[:16]
    out.append(rec)

out.sort(key=lambda r:-(r["claims_covered"] or 0))
doc={"generated_at":TODAY,"model":"claude-opus-5","auth":"claude.ai subscription",
     "runs_per_scenario":3,"currency":"NZD","gst_basis":"exclusive",
     "source_catalogue":"QV CostBuilder local capture 2026-09-09 (9,816 priced rows)",
     "counts":{"scenarios":len(out),
               "agreed":sum(1 for r in out if r["status"]=="agreed"),
               "disputed":sum(1 for r in out if r["status"]=="disputed"),
               "not_established":sum(1 for r in out if r["status"]=="not_established"),
               "claims_covered":sum(r["claims_covered"] or 0 for r in out)},
     "scenarios":out}
json.dump(doc,open("review-feed.json","w"),indent=1)
print(json.dumps(doc["counts"],indent=1))
print("bytes:",os.path.getsize("review-feed.json"))
