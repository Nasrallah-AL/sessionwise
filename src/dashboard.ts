import { recommendationCategory } from "./categorize.js";
import { calculateSessionMetrics } from "./metrics.js";
import type { Analysis, Recommendation, RelevanceKind, RelevanceReport } from "./types.js";

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const formatNumber = (value: number) => new Intl.NumberFormat("en-US", { notation: "compact" }).format(value);
const formatMoney = (value: number) => `$${value.toFixed(value >= 10 ? 2 : 4)}`;

function recommendationCard(recommendation: Recommendation): string {
  const category = recommendationCategory(recommendation);
  const evidence = recommendation.evidence
    .map((item) => `<span><b>${escapeHtml(item.label)}</b>${escapeHtml(String(item.value))}</span>`)
    .join("");
  const searchable = [recommendation.title, recommendation.suggestion, recommendation.kind, recommendation.sessionId, ...recommendation.evidence.flatMap((item) => [item.label, String(item.value)])]
    .filter(Boolean).join(" ").toLowerCase();
  return `<article class="recommendation searchable shade-${category}" data-recommendation-category="${category}" data-search="${escapeHtml(searchable)}">
    <div class="recommendation-meta"><span class="risk ${recommendation.risk}">${recommendation.risk}</span><span>${category}</span></div>
    <h3>${escapeHtml(recommendation.title)}</h3>
    <p>${escapeHtml(recommendation.suggestion)}</p>
    <div class="evidence">${evidence}</div>
    <footer><code>${escapeHtml(recommendation.kind)}</code>${recommendation.sessionId ? `<a href="#session-${escapeHtml(recommendation.sessionId)}">Open session</a>` : ""}</footer>
  </article>`;
}

export function generateDashboard(analysis: Analysis, relevance?: RelevanceReport): string {
  const aggregate = calculateSessionMetrics(analysis.events);
  const maxCost = Math.max(...analysis.sessions.map((session) => session.costUsd), 0.000001);
  const sessionRows = analysis.sessions.map((session) => {
    const model = session.models.join(", ") || "unknown";
    const searchable = `${session.id} ${model} ${session.routes.join(" ")}`.toLowerCase();
    return `<tr id="session-${escapeHtml(session.id)}" class="searchable" data-search="${escapeHtml(searchable)}">
      <td><strong>${escapeHtml(session.id)}</strong><small>${session.eventCount} calls, ${formatNumber(session.inputTokens + session.outputTokens)} tokens</small></td>
      <td>${escapeHtml(model)}<small>${session.metrics.modelPicking.fitScore === null ? "Fit unavailable" : `${session.metrics.modelPicking.fitScore}/100 fit`}</small></td>
      <td>${session.metrics.cache.hitRate === null ? "n/a" : `${Math.round(session.metrics.cache.hitRate * 100)}%`}</td>
      <td>${session.metrics.context.efficiencyScore ?? "n/a"}</td>
      <td>${session.metrics.health.score}</td>
      <td class="cost"><span>${formatMoney(session.costUsd)}</span><i style="--width:${Math.max(2, (session.costUsd / maxCost) * 100)}%"></i></td>
    </tr>`;
  }).join("");

  const recommendationCards = analysis.recommendations.map(recommendationCard).join("") || `<div class="empty"><strong>No recommendations.</strong><span>More session activity is needed.</span></div>`;
  const relevanceKinds: Array<{ kind: RelevanceKind; label: string }> = [
    { kind: "context", label: "Context" },
    { kind: "skill", label: "Skills" },
    { kind: "tool", label: "Tools" },
  ];
  const relevanceCards = relevance
    ? relevanceKinds.map(({ kind, label }) => {
        const metric = relevance.metrics[kind];
        const rate = metric.relevantRate === null ? "n/a" : `${Math.round(metric.relevantRate * 100)}%`;
        const flagged = relevance.judgments.filter((judgment) => judgment.kind === kind && judgment.label === "irrelevant").slice(0, 3).map((judgment) => judgment.name);
        const searchable = `${label} ${flagged.join(" ")}`.toLowerCase();
        return `<article class="relevance-card searchable" data-search="${escapeHtml(searchable)}">
          <span>${escapeHtml(label)} relevance</span><b>${rate}</b>
          <div class="relevance-counts"><span><strong>${metric.relevant}</strong> relevant</span><span><strong>${metric.irrelevant}</strong> irrelevant</span><span><strong>${metric.uncertain}</strong> uncertain</span></div>
          <div class="meter" aria-label="${escapeHtml(label)} relevant rate"><i style="--width:${metric.relevantRate === null ? 0 : metric.relevantRate * 100}%"></i></div>
          ${flagged.length ? `<p>Flagged: ${flagged.map(escapeHtml).join(", ")}</p>` : ""}
        </article>`;
      }).join("")
    : `<div class="empty"><strong>Relevance has not been analyzed.</strong><span>Run <code>sessionwise relevance --session &lt;id&gt;</code>.</span></div>`;
  const relevanceRows = relevance?.judgments.map((judgment) => {
    const searchable = `${judgment.kind} ${judgment.name} ${judgment.label} ${judgment.sessionId}`.toLowerCase();
    return `<tr class="searchable" data-search="${escapeHtml(searchable)}"><td>${escapeHtml(judgment.kind)}</td><td><strong>${escapeHtml(judgment.name)}</strong><small>${escapeHtml(judgment.sessionId)}</small></td><td><span class="judgment ${judgment.label}">${judgment.label}</span></td></tr>`;
  }).join("") ?? "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="SessionWise analysis of Claude Code sessions">
<link rel="icon" href="data:,">
<title>SessionWise report</title>
<style>
:root{--canvas:#faf9f5;--ink:#141413;--body:#3d3d3a;--muted:#6c6a64;--muted-soft:#8e8b82;--hairline:#e6dfd8;--surface-soft:#f5f0e8;--surface-card:#efe9de;--surface-strong:#e8e0d2;--dark:#181715;--dark-soft:#252320;--coral:#cc785c;--coral-active:#a9583e;--success:#477d58;--warning:#956400;--error:#a33f3f}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--canvas);color:var(--ink);font-family:"Avenir Next","Segoe UI",sans-serif;font-size:15px}.skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:12px;z-index:3;background:var(--dark);color:var(--canvas);padding:10px 14px;border-radius:6px}.shell{max-width:1240px;margin:auto;padding:0 32px 72px}.topbar{height:64px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--hairline)}.brand{font-weight:600;letter-spacing:-.02em}.brand::before{content:"*";color:var(--coral);font-size:22px;margin-right:7px}.topbar span:last-child{color:var(--muted);font-size:13px}.report-head{padding:48px 0 30px;display:flex;align-items:end;justify-content:space-between;gap:32px}.report-head h1,.section-head h2{font-family:"Iowan Old Style",Baskerville,Georgia,serif;font-weight:400;letter-spacing:-.025em}.report-head h1{font-size:clamp(38px,6vw,64px);line-height:1.02;margin:0}.report-head p{margin:8px 0 0;color:var(--muted)}.control-panel{position:sticky;top:12px;z-index:2;background:var(--dark);color:var(--canvas);border-radius:12px;padding:12px;display:grid;grid-template-columns:auto minmax(240px,1fr);gap:12px;margin-bottom:24px;box-shadow:0 6px 24px rgba(20,20,19,.08)}.category-tabs,.recommendation-filters{display:flex;gap:4px;flex-wrap:wrap}.category-tabs button,.recommendation-filters button{font:500 13px "Avenir Next","Segoe UI",sans-serif;border:0;cursor:pointer;transition:background .18s,color .18s,transform .18s}.category-tabs button{color:#c9c5bd;background:transparent;border-radius:8px;padding:10px 13px}.category-tabs button:hover,.category-tabs button[aria-selected="true"]{background:var(--dark-soft);color:var(--canvas)}button:active{transform:scale(.98)}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid var(--coral);outline-offset:2px}.search{position:relative}.search label{position:absolute;width:1px;height:1px;overflow:hidden}.search input{width:100%;height:40px;border:1px solid #3a3834;border-radius:8px;background:var(--dark-soft);color:var(--canvas);padding:0 92px 0 14px;font:400 14px "Avenir Next","Segoe UI",sans-serif}.search input::placeholder{color:#9f9b93}.search-status{position:absolute;right:12px;top:12px;color:#a9a59d;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--hairline);border:1px solid var(--hairline);border-radius:12px;overflow:hidden}.metrics.section{padding-top:0}.metric{background:var(--surface-soft);padding:22px}.metric:nth-child(even){background:var(--surface-card)}.metric b{display:block;font:400 clamp(30px,4vw,44px)/1 "Iowan Old Style",Baskerville,Georgia,serif;letter-spacing:-.03em}.metric span{display:block;color:var(--muted);font-size:13px;margin-top:10px}.section{padding-top:64px}.section[hidden],.searchable[hidden]{display:none!important}.section-head{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:18px}.section-head h2{font-size:34px;line-height:1.1;margin:0}.section-head p{margin:0;color:var(--muted);font-size:13px}.relevance-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.relevance-card{background:var(--surface-card);border-radius:12px;padding:24px;min-height:230px}.relevance-card:nth-child(2){background:var(--surface-soft)}.relevance-card:nth-child(3){background:var(--surface-strong)}.relevance-card>span{color:var(--body);font-weight:500}.relevance-card>b{display:block;font:400 48px/1 "Iowan Old Style",Baskerville,Georgia,serif;margin:30px 0 18px}.relevance-counts{display:flex;gap:12px;flex-wrap:wrap;color:var(--muted);font-size:12px}.relevance-counts strong{color:var(--ink)}.meter{height:5px;background:rgba(20,20,19,.1);margin-top:18px;border-radius:3px;overflow:hidden}.meter i{display:block;height:100%;width:var(--width);background:var(--coral)}.relevance-card p{font-size:12px;color:var(--muted);margin:16px 0 0}.detail-table{margin-top:12px}.recommendation-toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:12px}.recommendation-filters button{background:transparent;color:var(--muted);padding:8px 12px;border-radius:8px}.recommendation-filters button.active,.recommendation-filters button:hover{background:var(--surface-card);color:var(--ink)}.recommendations{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.recommendation{border-radius:12px;padding:22px;min-height:248px;display:flex;flex-direction:column}.shade-model{background:#eee8de}.shade-context{background:#f3ede4}.shade-tools{background:#e9e2d7}.shade-cost{background:#f5f0e8}.recommendation-meta{display:flex;justify-content:space-between;color:var(--muted);font-size:12px;text-transform:capitalize}.risk{padding:3px 7px;border-radius:4px;font-weight:600}.risk.safe{color:var(--success);background:#e1eadf}.risk.review{color:var(--warning);background:#f5e9c9}.risk.verify{color:#725a91;background:#ebe4f0}.recommendation h3{font-family:"Iowan Old Style",Baskerville,Georgia,serif;font-size:23px;font-weight:400;line-height:1.2;letter-spacing:-.015em;margin:24px 0 8px}.recommendation>p{color:var(--body);line-height:1.55;margin:0}.evidence{display:flex;gap:6px;flex-wrap:wrap;margin-top:18px}.evidence span{background:rgba(250,249,245,.65);border-radius:6px;padding:6px 8px;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.evidence b{font-weight:400;color:var(--muted);margin-right:6px}.recommendation footer{display:flex;justify-content:space-between;align-items:end;margin-top:auto;padding-top:20px}.recommendation code,.recommendation a{font-size:11px;color:var(--muted)}.recommendation a{color:var(--coral-active);text-decoration:none}.table-wrap{overflow:auto;border:1px solid var(--hairline);border-radius:12px;max-height:680px;background:var(--canvas)}table{width:100%;border-collapse:collapse;min-width:760px}th{position:sticky;top:0;background:var(--surface-strong);z-index:1;text-align:left;color:var(--body);font-size:12px;font-weight:500;padding:12px 16px}td{padding:14px 16px;border-top:1px solid var(--hairline);font-size:13px}tbody tr:nth-child(even){background:var(--surface-soft)}tbody tr:hover{background:var(--surface-card)}td strong,td small{display:block}td small{color:var(--muted);margin-top:4px}.cost{min-width:130px}.cost i{display:block;width:var(--width);height:3px;background:var(--coral);margin-top:7px}.judgment{display:inline-block;padding:4px 8px;border-radius:5px;font-size:12px}.judgment.relevant{background:#e1eadf;color:var(--success)}.judgment.irrelevant{background:#f1dfda;color:var(--error)}.judgment.uncertain{background:#f5e9c9;color:var(--warning)}.empty{grid-column:1/-1;background:var(--surface-soft);border-radius:12px;padding:36px;text-align:center}.empty span{display:block;color:var(--muted);margin-top:7px}.footnote{margin-top:64px;padding-top:18px;border-top:1px solid var(--hairline);color:var(--muted);font-size:12px}.footnote strong{color:var(--body)}
@media(max-width:760px){.shell{padding:0 16px 48px}.topbar{height:56px}.topbar span:last-child{display:none}.report-head{padding:34px 0 22px}.report-head h1{font-size:42px}.control-panel{position:static;grid-template-columns:1fr;padding:10px}.category-tabs{display:grid;grid-template-columns:repeat(2,1fr)}.category-tabs button{padding:9px 10px;font-size:12px}.metrics{grid-template-columns:1fr 1fr}.metric{padding:18px}.section{padding-top:48px}.section-head{align-items:start;flex-direction:column;gap:6px}.section-head h2{font-size:30px}.relevance-grid,.recommendations{grid-template-columns:1fr}.recommendation-toolbar{align-items:start;flex-direction:column}.table-wrap{max-height:560px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*{transition:none!important}}
</style>
</head>
<body>
<a class="skip" href="#content">Skip to report</a>
<main class="shell" id="content">
  <header class="topbar"><div class="brand">SessionWise</div><span>Claude Code report</span></header>
  <section class="report-head"><div><h1>Claude Code sessions</h1><p>${analysis.sessions.length} sessions, generated ${escapeHtml(new Date(analysis.generatedAt).toLocaleDateString())}</p></div></section>
  <div class="control-panel">
    <nav class="category-tabs" aria-label="Report categories">
      <button type="button" data-view="overview" aria-selected="true">Overview</button>
      <button type="button" data-view="relevance" aria-selected="false">Relevance</button>
      <button type="button" data-view="recommendations" aria-selected="false">Recommendations</button>
      <button type="button" data-view="sessions" aria-selected="false">Sessions</button>
    </nav>
    <div class="search"><label for="report-search">Search report</label><input id="report-search" type="search" placeholder="Search report"><span class="search-status" aria-live="polite"></span></div>
  </div>
  <section class="metrics section" data-section="overview" aria-label="Overview">
    <div class="metric"><b>${analysis.sessions.length}</b><span>Sessions</span></div>
    <div class="metric"><b>${analysis.totals.eventCount}</b><span>Model calls</span></div>
    <div class="metric"><b>${aggregate.cache.hitRate === null ? "n/a" : `${Math.round(aggregate.cache.hitRate * 100)}%`}</b><span>Cache hit</span></div>
    <div class="metric"><b>${aggregate.modelPicking.fitScore ?? "n/a"}</b><span>Model fit</span></div>
  </section>
  <section class="section" data-section="relevance">
    <div class="section-head"><h2>Relevance</h2>${relevance ? `<p>${relevance.sampled} of ${relevance.available} candidates sampled</p>` : ""}</div>
    <div class="relevance-grid">${relevanceCards}</div>
    ${relevanceRows ? `<div class="table-wrap detail-table"><table><thead><tr><th>Category</th><th>Item</th><th>Result</th></tr></thead><tbody>${relevanceRows}</tbody></table></div>` : ""}
  </section>
  <section class="section" data-section="recommendations">
    <div class="section-head"><h2>Recommendations</h2><p>${analysis.recommendations.length} findings</p></div>
    <div class="recommendation-toolbar"><div class="recommendation-filters" aria-label="Recommendation categories"><button type="button" class="active" data-rec-filter="all">All</button><button type="button" data-rec-filter="model">Model</button><button type="button" data-rec-filter="context">Context</button><button type="button" data-rec-filter="tools">Tools</button><button type="button" data-rec-filter="cost">Cost</button></div></div>
    <div class="recommendations">${recommendationCards}</div>
  </section>
  <section class="section" data-section="sessions">
    <div class="section-head"><h2>Sessions</h2><p>Model, cache, context, and health</p></div>
    <div class="table-wrap"><table><thead><tr><th>Session</th><th>Model</th><th>Cache</th><th>Context</th><th>Health</th><th>Cost</th></tr></thead><tbody>${sessionRows}</tbody></table></div>
  </section>
  <footer class="footnote"><strong>Measured:</strong> model and cache metadata. <strong>Inferred:</strong> model fit and context efficiency. Semantic relevance uses sampled Jev judgments.</footer>
</main>
<script>
const state={view:"overview",recommendation:"all",query:""};
const sections=[...document.querySelectorAll("[data-section]")];
const searchables=[...document.querySelectorAll(".searchable")];
const status=document.querySelector(".search-status");
function applyFilters(){
  sections.forEach(section=>section.hidden=state.view!=="overview"&&section.dataset.section!==state.view);
  let visible=0;
  searchables.forEach(item=>{
    const section=item.closest("[data-section]");
    const categoryMatches=!item.dataset.recommendationCategory||state.recommendation==="all"||item.dataset.recommendationCategory===state.recommendation;
    const queryMatches=!state.query||(item.dataset.search||item.textContent||"").toLowerCase().includes(state.query);
    item.hidden=!categoryMatches||!queryMatches;
    if(!item.hidden&&!section?.hidden)visible++;
  });
  status.textContent=state.query?visible+" shown":"";
}
document.querySelectorAll("[data-view]").forEach(button=>button.addEventListener("click",()=>{
  state.view=button.dataset.view;
  document.querySelectorAll("[data-view]").forEach(item=>item.setAttribute("aria-selected",String(item===button)));
  applyFilters();
}));
document.querySelectorAll("[data-rec-filter]").forEach(button=>button.addEventListener("click",()=>{
  state.recommendation=button.dataset.recFilter;
  document.querySelectorAll("[data-rec-filter]").forEach(item=>item.classList.toggle("active",item===button));
  applyFilters();
}));
const search=document.querySelector("#report-search");
search.addEventListener("input",()=>{state.query=search.value.trim().toLowerCase();applyFilters()});
search.addEventListener("keydown",event=>{if(event.key==="Escape"){search.value="";state.query="";applyFilters()}});
applyFilters();
</script>
</body></html>`;
}
