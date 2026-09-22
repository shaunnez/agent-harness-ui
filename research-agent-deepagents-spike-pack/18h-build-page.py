import json, datetime
feed = json.load(open("review-feed.json"))
asks = json.load(open("ask-feed.json"))

HEAD = """<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Research review — unpriced scenarios</title>
<style>
:root{--bg:#11131a;--panel:#191c25;--line:#2a2f3d;--ink:#e6e8ee;--dim:#98a0b3;
 --ok:#4ade80;--warn:#fbbf24;--none:#94a3b8;--acc:#60a5fa;--bad:#f87171;
 --mono:ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:18px 24px;border-bottom:1px solid var(--line);display:flex;gap:24px;align-items:baseline;flex-wrap:wrap}
h1{font-size:17px;margin:0;font-weight:600}
.meta{color:var(--dim);font-size:12px}
.counts{margin-left:auto;display:flex;gap:14px;font-size:12px}
.counts b{font-variant-numeric:tabular-nums}
main{display:grid;grid-template-columns:minmax(380px,44%) 1fr;height:calc(100vh - 62px)}
@media(max-width:900px){main{grid-template-columns:1fr;height:auto}#detail{border-left:0;border-top:1px solid var(--line)}}
#list{overflow:auto;border-right:1px solid var(--line)}
#detail{overflow:auto;padding:22px 26px}
.filters{padding:10px 16px;border-bottom:1px solid var(--line);display:flex;gap:6px;flex-wrap:wrap;position:sticky;top:0;background:var(--bg);z-index:2}
button.f{background:transparent;border:1px solid var(--line);color:var(--dim);padding:4px 10px;border-radius:99px;cursor:pointer;font-size:12px}
button.f.on{background:var(--panel);color:var(--ink);border-color:var(--acc)}
.row{padding:12px 16px;border-bottom:1px solid var(--line);cursor:pointer;display:grid;grid-template-columns:1fr auto;gap:4px 12px}
.row:hover{background:var(--panel)}
.row.sel{background:var(--panel);box-shadow:inset 3px 0 0 var(--acc)}
.row .t{font-weight:500}
.row .b{font-family:var(--mono);font-size:13px;white-space:nowrap}
.row .s{grid-column:1/-1;display:flex;gap:10px;align-items:center;color:var(--dim);font-size:12px;flex-wrap:wrap}
.badge{font-size:11px;padding:1px 7px;border-radius:4px;font-weight:600;letter-spacing:.02em}
.agreed{background:rgba(74,222,128,.15);color:var(--ok)}
.disputed{background:rgba(251,191,36,.15);color:var(--warn)}
.not_established{background:rgba(148,163,184,.15);color:var(--none)}
.decided{font-size:11px;padding:1px 7px;border-radius:4px;font-weight:600}
.d-approved{background:rgba(74,222,128,.2);color:var(--ok)}
.d-rejected{background:rgba(248,113,113,.2);color:var(--bad)}
.d-rescope{background:rgba(96,165,250,.2);color:var(--acc)}
h2{font-size:19px;margin:0 0 2px}
.sub{color:var(--dim);font-size:12px;margin-bottom:18px}
.dis{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 18px}
.dis span{background:var(--panel);border:1px solid var(--line);padding:5px 10px;border-radius:6px;font-size:12px;font-family:var(--mono)}
.big{font-family:var(--mono);font-size:26px;font-weight:600;margin:4px 0}
.big small{font-size:13px;color:var(--dim);font-weight:400}
h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);margin:24px 0 8px;font-weight:600}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-bottom:10px}
.basis{color:var(--dim);font-size:13px;line-height:1.6}
table{width:100%;border-collapse:collapse;font-size:12.5px}
td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
th{color:var(--dim);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
td.n{font-family:var(--mono);white-space:nowrap}
a{color:var(--acc)}
ul{margin:6px 0;padding-left:18px}li{margin:5px 0;color:var(--dim);font-size:13px}
pre{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px;overflow:auto;font-size:12px;color:var(--dim);white-space:pre-wrap}
.act{position:sticky;bottom:0;background:linear-gradient(transparent,var(--bg) 22%);padding:22px 0 8px;margin-top:26px}
.act .btns{display:flex;gap:8px;flex-wrap:wrap}
.act button{padding:9px 16px;border-radius:7px;border:1px solid var(--line);background:var(--panel);color:var(--ink);cursor:pointer;font-size:13px;font-weight:500}
.act button.on{border-color:var(--acc);background:rgba(96,165,250,.18)}
textarea{width:100%;margin-top:9px;background:var(--panel);border:1px solid var(--line);color:var(--ink);border-radius:7px;padding:9px;font:13px/1.5 inherit;resize:vertical}
.empty{color:var(--dim);padding:60px 0;text-align:center}
.hash{font-family:var(--mono);font-size:11px;color:var(--dim)}
</style>
<header>
<div><h1>Research review — unpriced scenarios</h1>
<div class="meta" id="hdr"></div></div>
<div class="counts" id="counts"></div>
<div><button class="f" id="export">Export decisions</button></div>
</header>
<main>
<div id="list"><div class="filters" id="filters"></div><div id="rows"></div></div>
<div id="detail"><div class="empty">Select a scenario.</div></div>
</main>
<script>
const FEED = """

TAIL = r""";
const KEY="research-review-decisions-v1";
let dec={}; try{dec=JSON.parse(localStorage.getItem(KEY)||"{}")}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(dec))}catch(e){}};
const S=FEED.scenarios, ASKS=(FEED.asks||[]);
let filter="all", sel=null;

const money=(n)=>n==null?"—":Number(n).toLocaleString("en-NZ",{maximumFractionDigits:0});
const esc=(s)=>String(s??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

document.getElementById("hdr").textContent =
  `${FEED.generated_at} · ${FEED.model} · ${FEED.auth} · ${FEED.runs_per_scenario} runs per scenario · ${FEED.source_catalogue}`;

function counts(){
  const c=FEED.counts;
  const done=S.filter(s=>dec[s.scenario_id]?.decision).length;
  document.getElementById("counts").innerHTML =
    `<span><b>${c.scenarios}</b> scenarios</span><span><b>${c.claims_covered}</b> claims</span>`+
    `<span style="color:var(--ok)"><b>${c.agreed}</b> agreed</span>`+
    `<span style="color:var(--warn)"><b>${c.disputed}</b> disputed</span>`+
    `<span style="color:var(--none)"><b>${c.not_established}</b> no band</span>`+
    `<span style="color:var(--acc)"><b>${done}</b>/${c.scenarios} reviewed</span>`;
}
const FILTERS=[["all","All"],["agreed","Agreed"],["disputed","Disputed"],["not_established","No band"],["undecided","Not yet reviewed"]];
document.getElementById("filters").innerHTML=FILTERS.map(([k,l])=>
  `<button class="f${k==="all"?" on":""}" data-f="${k}">${l}</button>`).join("");
document.getElementById("filters").onclick=e=>{
  const b=e.target.closest("[data-f]"); if(!b)return;
  filter=b.dataset.f;
  [...document.querySelectorAll("#filters .f")].forEach(x=>x.classList.toggle("on",x===b));
  rows();
};

function rows(){
  const list=S.filter(s=> filter==="all" ? true
      : filter==="undecided" ? !dec[s.scenario_id]?.decision : s.status===filter);
  document.getElementById("rows").innerHTML=list.map(s=>{
    const d=dec[s.scenario_id]?.decision;
    const band=s.consensus?`${money(s.consensus.low)}–${money(s.consensus.high)}`:"no band";
    const ag=s.agreement.low_ratio?`agree ${s.agreement.low_ratio.toFixed(2)}× / ${s.agreement.high_ratio.toFixed(2)}×`:"";
    return `<div class="row${sel===s.scenario_id?" sel":""}" data-id="${s.scenario_id}">
      <div class="t">${esc(s.title)}</div>
      <div class="b">${band}</div>
      <div class="s"><span class="badge ${s.status}">${s.status.replace("_"," ")}</span>
        ${d?`<span class="decided d-${d}">${d}</span>`:""}
        <span>${s.claims_covered} claims</span><span>${esc(s.unit||"")}</span><span>${ag}</span></div>
    </div>`}).join("") || `<div class="empty">Nothing matches.</div>`;
  counts();
}
document.getElementById("rows").onclick=e=>{
  const r=e.target.closest("[data-id]"); if(!r)return;
  sel=r.dataset.id; rows(); detail();
  document.getElementById("detail").scrollTop=0;
};

function detail(){
  const s=S.find(x=>x.scenario_id===sel); if(!s)return;
  const d=dec[s.scenario_id]||{};
  const runs=s.runs.filter(r=>r.low!=null);
  const el=document.getElementById("detail");
  el.innerHTML=`
  <h2>${esc(s.title)}</h2>
  <div class="sub">${esc(s.family)} · ${s.claims_covered} unpriced claims across the tenders · <span class="hash">${s.record_sha256}</span></div>

  <div class="dis">
    <span>${s.currency}</span><span>GST ${s.gst_basis}</span>
    <span>${esc(s.centre||"—")}</span><span>as of ${s.as_of}</span>
  </div>

  ${s.consensus?`<div class="big">${money(s.consensus.low)} – ${money(s.consensus.high)} <small>${esc(s.unit||"")}</small></div>
    <div class="basis">Outer envelope across all runs ${money(s.range.min)} – ${money(s.range.max)}.
    Agreement ${s.agreement.low_ratio.toFixed(2)}× low, ${s.agreement.high_ratio.toFixed(2)}× high,
    from ${s.agreement.runs_with_band} of ${s.agreement.runs_total} runs.</div>`
   :`<div class="big">No band <small>— no run would price this</small></div>`}

  ${s.basis?`<h3>What the band includes</h3><div class="card basis">${esc(s.basis)}</div>`:""}

  ${runs.length>1?`<h3>The ${runs.length} runs</h3><div class="card"><table>
    <tr><th>run</th><th>low</th><th>high</th><th>from</th><th>confidence</th></tr>
    ${runs.map(r=>`<tr><td>${esc(r.run)}</td><td class="n">${money(r.low)}</td><td class="n">${money(r.high)}</td>
      <td>${esc(r.resolved_from||"")}</td><td>${esc(r.confidence||"")}</td></tr>`).join("")}
    </table>${s.status==="disputed"?`<div class="basis" style="margin-top:10px">These disagree. The gap usually means the scope leaves a price-moving parameter unstated — read the basis lines before rejecting the number.</div>`:""}</div>`:""}

  ${s.qv_sources.length?`<h3>QV rows used (${s.qv_sources.length})</h3><div class="card"><table>
    <tr><th>section / group</th><th>description</th><th>unit</th><th>AKL</th><th>WLG</th><th>CHC</th><th>runs</th></tr>
    ${s.qv_sources.map(q=>`<tr>
      <td><a href="${esc(q.url)}" target="_blank" rel="noopener">${esc(q.section||"")}</a>${q.group?`<br><span style="color:var(--dim)">${esc(q.group)}</span>`:""}</td>
      <td>${esc(q.desc||"")}</td><td class="n">${esc(q.unit||"")}</td>
      <td class="n">${esc((q.regional||{}).Auckland||"—")}</td>
      <td class="n">${esc((q.regional||{}).Wellington||"—")}</td>
      <td class="n">${esc((q.regional||{}).Christchurch||"—")}</td>
      <td class="n">${q.cited_by||1}/3</td></tr>`).join("")}
    </table></div>`:""}

  ${s.web_sources.length?`<h3>Web sources</h3><div class="card"><ul>${s.web_sources.map(u=>`<li><a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a></li>`).join("")}</ul></div>`:""}

  ${s.open_questions.length?`<h3>Open questions (${s.open_questions.length})</h3><div class="card"><ul>${s.open_questions.map(q=>`<li>${esc(q)}</li>`).join("")}</ul></div>`:""}

  ${s.pinned_scope?`<h3>The scope this was priced against</h3><pre>${esc(s.pinned_scope)}</pre>`:""}

  <div class="act">
    <h3 style="margin-top:0">Your decision</h3>
    <div class="btns">
      ${["approved","rejected","rescope"].map(k=>
        `<button data-d="${k}" class="${d.decision===k?"on":""}">${
          k==="approved"?"Approve — usable as a band":k==="rejected"?"Reject — wrong":"Scope is wrong — re-run"}</button>`).join("")}
    </div>
    <textarea rows="3" id="note" placeholder="Why? Especially if rejecting or re-scoping.">${esc(d.note||"")}</textarea>
  </div>`;

  el.querySelector(".btns").onclick=e=>{
    const b=e.target.closest("[data-d]"); if(!b)return;
    dec[s.scenario_id]={decision:b.dataset.d,note:el.querySelector("#note").value,
      decided_at:new Date().toISOString(),record_sha256:s.record_sha256};
    save(); rows(); detail();
  };
  el.querySelector("#note").onblur=e=>{
    if(!dec[s.scenario_id])dec[s.scenario_id]={decision:null};
    dec[s.scenario_id].note=e.target.value;
    dec[s.scenario_id].record_sha256=s.record_sha256; save();
  };
}

document.getElementById("export").onclick=()=>{
  const out={exported_at:new Date().toISOString(),generated_at:FEED.generated_at,
    decisions:Object.entries(dec).map(([id,v])=>({scenario_id:id,...v}))};
  const t=JSON.stringify(out,null,1);
  const w=window.open("","_blank");
  w.document.write("<title>decisions.json</title><pre style='font:12px ui-monospace,monospace;white-space:pre-wrap;padding:20px'>"+
    t.replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))+"</pre>");
  w.document.close();
};

rows();
</script>
"""

page = HEAD + json.dumps({**feed, "asks": asks.get("asks", [])}, separators=(",", ":")) + TAIL
open("review.html", "w").write(page)
print("review.html", len(page), "bytes")
