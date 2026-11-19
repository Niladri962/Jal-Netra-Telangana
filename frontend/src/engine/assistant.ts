// JalNetra Intelligence — local retrieval-augmented assistant (rule-based fallback).
// Retrieval: BM25 over the knowledge base (standards, programme summary, SOPs, methods).
// Grounding: intent handlers that query the LIVE simulation state (current derived values & alerts).
// When the FastAPI backend has an LLM configured, the same retrieved passages and a live-state
// snapshot (buildLLMContext) are sent to the backend instead; this module is then only the fallback.

import KB from '../data/knowledge_base.json';
import type { Derived } from './compute';
import { LOSS_LABEL } from './compute';
import { round } from './rng';
import type { AlertRecord, ForecastSettings, SimState, Thresholds } from './types';

export interface KBDoc {
  id: string;
  title: string;
  type: string;
  text: string;
}
export const KNOWLEDGE: KBDoc[] = KB as KBDoc[];

export interface AssistantCtx {
  state: SimState;
  derived: Derived;
  alerts: AlertRecord[];
  th: Thresholds;
  fc: ForecastSettings;
  selectedVillageId?: string;
}
export interface AssistantAnswer {
  text: string;
  sources: { id: string; title: string }[];
  villageId?: string;
  mode: 'local-rag' | 'llm';
}

// ------------------------------------------------------------------ BM25
const STOP = new Set('the a an of to and or in on at for is are be by with what which why how do does should when this that from as it its can show me my there any'.split(' '));
const tok = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));

const docsTok = KNOWLEDGE.map((d) => tok(`${d.title} ${d.title} ${d.text}`)); // title weighted ×2
const avgLen = docsTok.reduce((a, d) => a + d.length, 0) / docsTok.length;
const df = new Map<string, number>();
docsTok.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) ?? 0) + 1)));

export function retrieve(q: string, k = 3): (KBDoc & { score: number })[] {
  const qt = tok(q);
  const N = KNOWLEDGE.length;
  const scored = KNOWLEDGE.map((doc, i) => {
    const d = docsTok[i];
    let s = 0;
    for (const w of qt) {
      const f = d.filter((x) => x === w || (w.length > 4 && x.startsWith(w.slice(0, 5)))).length;
      if (!f) continue;
      const idf = Math.log(1 + (N - (df.get(w) ?? 0) + 0.5) / ((df.get(w) ?? 0) + 0.5));
      s += (idf * f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.length / avgLen)));
    }
    return { ...doc, score: s };
  });
  return scored.filter((d) => d.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
}

// ------------------------------------------------------------------ entity matching
export function matchVillage(q: string, ctx: AssistantCtx): string | undefined {
  const ql = q.toLowerCase();
  let best: string | undefined;
  let len = 0;
  for (const vid of ctx.state.villageOrder) {
    const n = ctx.state.villages[vid].name.toLowerCase();
    if (ql.includes(n) && n.length > len) {
      best = vid;
      len = n.length;
    }
  }
  if (best) return best;
  if (/\b(this|selected|current|the) village\b|village x\b/.test(ql)) return ctx.selectedVillageId;
  return undefined;
}
function matchDistrict(q: string, ctx: AssistantCtx) {
  const ql = q.toLowerCase();
  return ctx.state.districts.find((d) => ql.includes(d.name.toLowerCase()) || ql.includes(d.name.toLowerCase().split(/[\s–-]/)[0]));
}

const vName = (ctx: AssistantCtx, vid: string) => {
  const v = ctx.state.villages[vid];
  const d = ctx.state.districts.find((x) => x.id === v.districtId)!;
  return `**${v.name}** (${v.mandal}, ${d.name})`;
};
const dName = (ctx: AssistantCtx, id: string) => ctx.state.districts.find((d) => d.id === id)?.name ?? id;
const sevWord = (s: string) => (s === 'critical' ? '🔴 critical' : s === 'warning' ? '🟠 warning' : '🟢 normal');

// ------------------------------------------------------------------ intents
type Handler = (q: string, ctx: AssistantCtx) => AssistantAnswer | null;

const answer = (text: string, kb: string[], villageId?: string): AssistantAnswer => ({
  text,
  sources: kb.map((id) => KNOWLEDGE.find((d) => d.id === id)!).filter(Boolean).map((d) => ({ id: d.id, title: d.title })),
  villageId,
  mode: 'local-rag',
});

const whyAlert: Handler = (q, ctx) => {
  if (!/why|reason|explain|cause|what.*wrong|status/i.test(q)) return null;
  const vid = matchVillage(q, ctx);
  if (!vid) return null;
  const v = ctx.state.villages[vid];
  const vd = ctx.derived.villages[vid];
  const active = ctx.alerts.filter((a) => a.status === 'active' && a.villageId === vid);
  const lines = [`### Why ${vName(ctx, vid)} is ${sevWord(vd.status)}`];
  if (!active.length && vd.status === 'normal') {
    lines.push('There are **no active alerts** for this village right now. All monitored parameters are within the configured thresholds.');
  } else {
    lines.push(`Overall status is driven by the worst monitoring node (**${ctx.state.nodes[vd.worstNodeId].label}**, risk score **${vd.qualityRisk}/100**).`);
    lines.push('', '**Active alerts (from live simulated data):**');
    for (const a of active.sort((x, y) => (x.severity === 'critical' ? -1 : 1) - (y.severity === 'critical' ? -1 : 1)))
      lines.push(`- ${sevWord(a.severity)} — ${a.title.split(' — ')[0]}: **${a.value} ${a.unit}**${a.prevValue !== null ? ` (was ${a.prevValue})` : ''}`);
    lines.push('', '**What it means:**');
    const top = active.find((a) => a.severity === 'critical') ?? active[0];
    if (top) lines.push(top.explanation.split('Possible causes')[0]);
    lines.push('', '**Recommended actions:**');
    const acts = [...new Set(active.flatMap((a) => a.actions))].slice(0, 6);
    acts.forEach((x) => lines.push(`- ${x}`));
    lines.push('', `Health surveillance priority: **${vd.healthPriority}/100** (${sevWord(vd.healthStatus)}). Supply: **${vd.lpcd} LPCD** (${vd.fulfilledPct}% of norm).`);
  }
  lines.push('', `_Readings are simulated sensor values for ${v.name}; confirm by field testing before action._`);
  const kb = active.some((a) => a.param === 'chlorine') ? ['KB-04', 'KB-01', 'KB-10'] : active.some((a) => a.param === 'turbidity') ? ['KB-05', 'KB-01', 'KB-10'] : active.some((a) => a.param === 'tds') ? ['KB-06', 'KB-01'] : active.some((a) => a.param === 'loss') ? ['KB-08', 'KB-09'] : ['KB-10'];
  return answer(lines.join('\n'), kb, vid);
};

const abnormalQuality: Handler = (q, ctx) => {
  if (!/(abnormal|unsafe|poor|bad|alert|issue|problem).*(quality|water)|quality.*(abnormal|alert|issue)|which villages.*(alert|unsafe)/i.test(q)) return null;
  const list = Object.values(ctx.derived.villages).filter((v) => v.qualityStatus !== 'normal').sort((a, b) => b.qualityRisk - a.qualityRisk);
  if (!list.length) return answer('All monitored villages currently show **normal** water quality under the configured thresholds.', ['KB-10']);
  const lines = [`### ${list.length} villages currently have abnormal water quality`, '', '| Village | District | Status | Risk | Drivers |', '|---|---|---|---|---|'];
  for (const v of list.slice(0, 15)) {
    const vv = ctx.state.villages[v.id];
    lines.push(`| ${vv.name} | ${dName(ctx, vv.districtId)} | ${sevWord(v.qualityStatus)} | ${v.qualityRisk} | ${v.drivers.filter((d) => !d.startsWith('Supply')).slice(0, 2).join('; ')} |`);
  }
  lines.push('', '_Ask "Why is <village> showing a red alert?" for a detailed explanation._');
  return answer(lines.join('\n'), ['KB-10', 'KB-01']);
};

const paramVillages = (param: 'turbidity' | 'chlorine' | 'tds' | 'ph', label: string, kb: string[]): Handler => (q, ctx) => {
  const re = { turbidity: /turbid/i, chlorine: /chlorin/i, tds: /\btds\b|dissolved/i, ph: /\bph\b/i }[param];
  if (!re.test(q)) return null;
  if (param === 'chlorine' && /what should|operator|do when|drop|procedure|sop/i.test(q)) {
    const low = Object.values(ctx.derived.nodes).filter((n) => n.params.chlorine.severity !== 'normal' && n.params.chlorine.direction === 'low');
    const kbDoc = KNOWLEDGE.find((d) => d.id === 'KB-04')!;
    const steps = kbDoc.text.split(/\(\d\)\s*/).slice(1);
    const lines = ['### Operator procedure when residual chlorine drops', '', ...steps.map((s, i) => `${i + 1}. ${s.trim()}`), '', `**Live context:** ${low.length} monitoring node(s) currently report low residual chlorine${low.length ? ': ' + [...new Set(low.map((n) => ctx.state.villages[n.villageId].name))].slice(0, 8).join(', ') : ''}.`];
    return answer(lines.join('\n'), ['KB-04', 'KB-01', 'KB-15'], low[0]?.villageId);
  }
  const nodes = Object.values(ctx.derived.nodes).filter((n) => n.params[param].severity !== 'normal');
  const byV = new Map<string, number>();
  nodes.forEach((n) => byV.set(n.villageId, param === 'chlorine' || param === 'ph' ? Math.min(byV.get(n.villageId) ?? 99, n.params[param].value) : Math.max(byV.get(n.villageId) ?? 0, n.params[param].value)));
  if (!byV.size) return answer(`No villages currently exceed the ${label} thresholds.`, kb);
  const lines = [`### Villages with ${label} outside thresholds (${byV.size})`, ''];
  [...byV.entries()].sort((a, b) => (param === 'chlorine' ? a[1] - b[1] : b[1] - a[1])).slice(0, 12).forEach(([vid, val]) => {
    const n = nodes.find((x) => x.villageId === vid)!;
    lines.push(`- ${vName(ctx, vid)} — **${val}** ${param === 'ph' ? '' : param === 'tds' ? 'mg/L' : param === 'chlorine' ? 'mg/L' : 'NTU'} (${sevWord(n.params[param].severity)})`);
  });
  return answer(lines.join('\n'), kb);
};

const districtDeficit: Handler = (q, ctx) => {
  if (!/district/i.test(q) || !/deficit|shortage|gap|worst supply|lowest supply|lpcd/i.test(q)) return null;
  const ds = Object.values(ctx.derived.districts).sort((a, b) => b.deficitMLD - a.deficitMLD);
  const lines = ['### Districts by water supply deficit (simulated villages)', '', '| District | Deficit (MLD) | Avg LPCD | Underserved pop. |', '|---|---|---|---|'];
  ds.slice(0, 8).forEach((d) => lines.push(`| ${d.name} | ${d.deficitMLD} | ${d.avgLpcd} | ${d.underservedPop.toLocaleString('en-IN')} |`));
  lines.push('', `**${ds[0].name}** has the highest deficit: ${ds[0].deficitMLD} MLD against demand of ${ds[0].demandMLD} MLD.`);
  return answer(lines.join('\n'), ['KB-13', 'KB-03']);
};

const supply30: Handler = (q, ctx) => {
  if (!/supply|performance/i.test(q) || !/30|month|last|history|trend|performance/i.test(q) || /forecast|projected|next/i.test(q)) return null;
  const days = ctx.state.supplyHistory[ctx.state.villageOrder[0]].map((d) => d.day);
  const tot = days.map((_, i) => ctx.state.villageOrder.reduce((a, v) => a + ctx.state.supplyHistory[v][i].suppliedKL, 0) / 1000);
  const dem = days.map((_, i) => ctx.state.villageOrder.reduce((a, v) => a + ctx.state.supplyHistory[v][i].demandKL, 0) / 1000);
  const interruptions = ctx.state.villageOrder.reduce((a, v) => a + ctx.state.supplyHistory[v].filter((d) => d.interrupted).length, 0);
  const avg = tot.reduce((a, b) => a + b, 0) / tot.length;
  const avgD = dem.reduce((a, b) => a + b, 0) / dem.length;
  const minI = tot.indexOf(Math.min(...tot));
  const lines = [
    '### Water supply performance — last 30 days (simulated)',
    '',
    `- Average supplied: **${round(avg, 2)} MLD** vs estimated demand **${round(avgD, 2)} MLD** (**${round((avg / avgD) * 100, 1)}%** fulfilled)`,
    `- Lowest day: **${days[minI]}** at ${round(tot[minI], 2)} MLD`,
    `- Village-days with supply interruption: **${interruptions}** of ${days.length * ctx.state.villageOrder.length}`,
    `- Current live supply: **${ctx.derived.kpi.supplyMLD} MLD**, average **${ctx.derived.kpi.avgLpcd} LPCD**`,
    '',
    '_See Executive Command Centre → Daily water supply trends for the chart._',
  ];
  return answer(lines.join('\n'), ['KB-03', 'KB-13']);
};

const equityLow: Handler = (q, ctx) => {
  if (!/equit|underserved|lowest.*(score|supply)/i.test(q)) return null;
  const list = Object.values(ctx.derived.villages).sort((a, b) => a.equityScore - b.equityScore).slice(0, 10);
  const lines = ['### Lowest water equity scores (live)', '', '| Rank | Village | District | Equity | LPCD | Fulfilled |', '|---|---|---|---|---|---|'];
  list.forEach((v, i) => {
    const vv = ctx.state.villages[v.id];
    lines.push(`| ${i + 1} | ${vv.name} | ${dName(ctx, vv.districtId)} | ${v.equityScore} | ${v.lpcd} | ${v.fulfilledPct}% |`);
  });
  lines.push('', `State-wide LPCD Gini coefficient: **${ctx.derived.kpi.gini}** (0 = perfectly equal).`);
  return answer(lines.join('\n'), ['KB-13']);
};

function pearson(x: number[], y: number[]) {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sx += (x[i] - mx) ** 2;
    sy += (y[i] - my) ** 2;
  }
  return sx && sy ? sxy / Math.sqrt(sx * sy) : 0;
}

export function healthCorrelation(ctx: AssistantCtx) {
  const ids = ctx.state.villageOrder;
  const risk = ids.map((v) => ctx.derived.villages[v].healthComponents.water);
  const cases = ids.map((v) => ctx.derived.villages[v].recentCasesPer10k);
  const weeklyR: number[] = [];
  const weeklyC: number[] = [];
  ids.forEach((v) =>
    ctx.state.health[v].forEach((w) => {
      weeklyR.push(w.waterRiskIndicator);
      weeklyC.push((w.diarrhoea / Math.max(1, w.population)) * 10000);
    }),
  );
  return { current: round(pearson(risk, cases), 2), weekly: round(pearson(weeklyR, weeklyC), 2), n: ids.length, nWeekly: weeklyR.length };
}

const healthRel: Handler = (q, ctx) => {
  if (!/diarrh|relationship|correlat|disease|cholera|typhoid|health/i.test(q)) return null;
  const c = healthCorrelation(ctx);
  const watch = Object.values(ctx.derived.villages).filter((v) => v.healthStatus !== 'normal').sort((a, b) => b.healthPriority - a.healthPriority);
  const lines = [
    '### Water quality vs suspected diarrhoeal cases (synthetic surveillance data)',
    '',
    `- Pearson correlation, current water-quality component vs recent cases per 10k across ${c.n} villages: **r = ${c.current}**`,
    `- Pearson correlation, weekly water-risk indicator vs weekly cases per 10k (${c.nWeekly} village-weeks): **r = ${c.weekly}**`,
    '',
    `**${watch.length}** village(s) are on health surveillance watch:`,
    ...watch.slice(0, 8).map((v) => `- ${vName(ctx, v.id)} — priority **${v.healthPriority}/100**, case trend ×${v.caseTrendRatio}`),
    '',
    '**Interpretation:** a positive correlation indicates that villages/weeks with worse disinfection indicators also tend to report more suspected cases in this synthetic dataset. It **does not establish causation** and is not an outbreak confirmation — confounders (sanitation, hygiene, reporting completeness) are not modelled. Use it to prioritise confirmatory sampling and health-department follow-up.',
  ];
  return answer(lines.join('\n'), ['KB-11', 'KB-12', 'KB-04'], watch[0]?.id);
};

const pipelineInspect: Handler = (q, ctx) => {
  if (!/pipe|segment|leak|loss|tapping|inspection/i.test(q)) return null;
  const segs = Object.values(ctx.derived.segments).filter((s) => s.severity !== 'normal' && (s.kind === 'distribution' || s.kind === 'transmission')).sort((a, b) => b.lossPct - a.lossPct);
  if (!segs.length) return answer('No monitored pipeline segment currently exceeds the water-balance tolerance.', ['KB-09']);
  const lines = ['### Pipeline segments requiring inspection', '', '| Segment | Classification | Loss | Severity |', '|---|---|---|---|'];
  for (const s of segs.slice(0, 10)) {
    const seg = ctx.state.segments.find((x) => x.id === s.id)!;
    const where = seg.kind === 'transmission' ? `${dName(ctx, seg.districtId)} transmission main` : `${ctx.state.villages[seg.villageId!].name} distribution main`;
    lines.push(`| ${where} | ${LOSS_LABEL[s.classification]} | ${s.lossPct}% | ${sevWord(s.severity)} |`);
  }
  lines.push('', 'Prioritise **critical suspected leakage** first (pressure loss implies contamination ingress risk), then possible unauthorised draw-off (field verification, not enforcement), then measurement-uncertainty cases (recalibrate meters).');
  return answer(lines.join('\n'), ['KB-08', 'KB-09']);
};

const demand30: Handler = (q, ctx) => {
  if (!/forecast|projected|projection|next 30|next 7|future demand|demand/i.test(q)) return null;
  const vs = Object.values(ctx.derived.villages);
  const d30 = vs.reduce((a, v) => a + v.forecast.total30Demand, 0) / 1000;
  const c30 = vs.reduce((a, v) => a + v.forecast.total30Capacity, 0) / 1000;
  const d7 = vs.reduce((a, v) => a + v.forecast.avg7Demand, 0) / 1000;
  const short = vs.filter((v) => v.forecast.deficit7Pct > ctx.th.forecastDeficitPct).sort((a, b) => b.forecast.deficit7Pct - a.forecast.deficit7Pct);
  const mape = vs.reduce((a, v) => a + v.forecast.mape, 0) / vs.length;
  const lines = [
    '### Projected water demand (illustrative model)',
    '',
    `- Next 30 days: **${round(d30, 1)} ML** demand vs **${round(c30, 1)} ML** supply capacity → deficit **${round(Math.max(0, d30 - c30), 1)} ML**`,
    `- Next 7 days: average **${round(d7, 2)} MLD** demand`,
    `- Scenario inputs: ${ctx.fc.lpcd} LPCD, ${ctx.fc.temperatureC} °C, ${ctx.fc.rainfallMM} mm/day rain, population ${ctx.fc.populationChangePct >= 0 ? '+' : ''}${ctx.fc.populationChangePct}%, capacity ${ctx.fc.supplyCapacityPct}%`,
    `- Villages likely to face >${ctx.th.forecastDeficitPct}% shortage: **${short.length}**${short.length ? ' — ' + short.slice(0, 6).map((v) => ctx.state.villages[v.id].name).join(', ') : ''}`,
    `- Backtest MAPE (mean across villages): **${round(mape, 1)}%**`,
    '',
    '_Illustrative OLS model on synthetic history — not a validated production forecasting model._',
  ];
  return answer(lines.join('\n'), ['KB-14']);
};

const districtSummary: Handler = (q, ctx) => {
  const d = matchDistrict(q, ctx);
  if (!d) return null;
  const dd = ctx.derived.districts[d.id];
  const crit = ctx.alerts.filter((a) => a.status === 'active' && a.districtId === d.id);
  const lines = [
    `### ${d.name} district — live summary (simulated network)`,
    '',
    `- Monitored villages: **${dd.villages}**, sensor nodes: **${dd.sensors}**, population covered: **${dd.population.toLocaleString('en-IN')}**`,
    `- Supply **${dd.supplyMLD} MLD** vs demand **${dd.demandMLD} MLD**; average **${dd.avgLpcd} LPCD**`,
    `- Water quality: ${sevWord(dd.qualityStatus)} (${dd.counts.critical} critical, ${dd.counts.warning} warning villages)`,
    `- Pipeline integrity: ${sevWord(dd.pipelineStatus)}, estimated loss ${dd.lossPct}%`,
    `- Equity score ${dd.equityScore}, LPCD Gini ${dd.gini}`,
    `- Active alerts: **${crit.length}** (${crit.filter((a) => a.severity === 'critical').length} critical)`,
    ...crit.slice(0, 5).map((a) => `  - ${sevWord(a.severity)} ${a.title}`),
  ];
  return answer(lines.join('\n'), ['KB-03', 'KB-18']);
};

const villageSummary: Handler = (q, ctx) => {
  const vid = matchVillage(q, ctx);
  if (!vid) return null;
  return whyAlert('why ' + q, ctx);
};

const HANDLERS: Handler[] = [
  whyAlert,
  paramVillages('chlorine', 'residual chlorine', ['KB-04', 'KB-01']),
  paramVillages('turbidity', 'turbidity', ['KB-05', 'KB-01']),
  paramVillages('tds', 'TDS', ['KB-06', 'KB-01']),
  paramVillages('ph', 'pH', ['KB-07', 'KB-01']),
  abnormalQuality,
  districtDeficit,
  equityLow,
  healthRel,
  pipelineInspect,
  supply30,
  demand30,
  districtSummary,
  villageSummary,
];

export function answerLocal(q: string, ctx: AssistantCtx): AssistantAnswer {
  for (const h of HANDLERS) {
    const a = h(q, ctx);
    if (a) return a;
  }
  const docs = retrieve(q, 2);
  if (docs.length) {
    const lines = ['Here is what the JalNetra knowledge base says:', ''];
    docs.forEach((d) => lines.push(`**${d.title}** — ${d.text}`, ''));
    return { text: lines.join('\n'), sources: docs.map((d) => ({ id: d.id, title: d.title })), mode: 'local-rag' };
  }
  return answer(
    'I could not match that question. Try: "Which villages currently have abnormal water quality?", "Why is <village> showing a red alert?", "Which district has the highest water supply deficit?", "What should an operator do when chlorine levels drop?", or "What is the projected water demand for the next 30 days?"',
    [],
  );
}

/** Compact live-state snapshot sent to the LLM backend (grounding for genuine RAG). */
export function buildLLMContext(q: string, ctx: AssistantCtx) {
  const vid = matchVillage(q, ctx) ?? ctx.selectedVillageId;
  const d = ctx.derived;
  const village = vid
    ? {

        ...ctx.state.villages[vid],
        district: dName(ctx, ctx.state.villages[vid].districtId),
        derived: { ...d.villages[vid], nodes: undefined, forecast: { avg7Demand: d.villages[vid].forecast.avg7Demand, deficit7Pct: d.villages[vid].forecast.deficit7Pct } },
        nodes: ctx.state.villages[vid].nodeIds.map((n) => ({ id: n, label: ctx.state.nodes[n].label, readings: ctx.state.nodes[n].current, baseline: ctx.state.nodes[n].baseline, status: d.nodes[n].status, risk: d.nodes[n].risk, fault: ctx.state.nodes[n].fault })),
        health_weeks: ctx.state.health[vid].slice(-6),
      }
    : null;
  return {
    sim_time: new Date(ctx.state.simTime).toISOString(),
    disclaimer: 'All data synthetic/simulated; not government data.',
    thresholds: ctx.th,
    forecast_settings: ctx.fc,
    kpi: d.kpi,
    focus_village: village,
    active_alerts: ctx.alerts
      .filter((a) => a.status === 'active')
      .sort((a, b) => (a.severity === 'critical' ? -1 : 1) - (b.severity === 'critical' ? -1 : 1))
      .slice(0, 40)
      .map((a) => ({ title: a.title, category: a.category, severity: a.severity, value: a.value, unit: a.unit, prev: a.prevValue, village: a.villageId ? ctx.state.villages[a.villageId].name : null, district: dName(ctx, a.districtId) })),
    districts: Object.values(d.districts).map((x) => ({ name: x.name, villages: x.villages, pop: x.population, supplyMLD: x.supplyMLD, demandMLD: x.demandMLD, lpcd: x.avgLpcd, quality: x.qualityStatus, lossPct: x.lossPct, equity: x.equityScore, deficitMLD: x.deficitMLD })),
    worst_villages: Object.values(d.villages)
      .sort((a, b) => b.qualityRisk - a.qualityRisk)
      .slice(0, 12)
      .map((v) => ({ name: ctx.state.villages[v.id].name, district: dName(ctx, ctx.state.villages[v.id].districtId), risk: v.qualityRisk, status: v.status, lpcd: v.lpcd, equity: v.equityScore, health: v.healthPriority, drivers: v.drivers })),
    lowest_equity: Object.values(d.villages)
      .sort((a, b) => a.equityScore - b.equityScore)
      .slice(0, 8)
      .map((v) => ({ name: ctx.state.villages[v.id].name, equity: v.equityScore, lpcd: v.lpcd })),
    flagged_segments: Object.values(d.segments)
      .filter((s) => s.severity !== 'normal' && s.kind !== 'service')
      .map((s) => ({ id: s.id, class: LOSS_LABEL[s.classification], lossPct: s.lossPct, severity: s.severity, note: s.note })),
    forecast_totals: {
      demand30_ML: round(Object.values(d.villages).reduce((a, v) => a + v.forecast.total30Demand, 0) / 1000, 1),
      capacity30_ML: round(Object.values(d.villages).reduce((a, v) => a + v.forecast.total30Capacity, 0) / 1000, 1),
    },
    health_correlation: healthCorrelation(ctx),
  };
}
