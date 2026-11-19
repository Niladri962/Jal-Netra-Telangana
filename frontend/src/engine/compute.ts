// Derived intelligence layer — recomputed after every change. Every KPI, map colour, ranking and
// alert in the UI is derived from here, so a single changed reading propagates everywhere.

import { evalParam, HYDRAULIC_PARAMS, PARAM_INFO, QUALITY_PARAMS, RISK_WEIGHTS, sevRank, worst, type ParamEval } from './thresholds';
import { clamp, round } from './rng';
import { diurnal, hydraulicFactor } from './sim';
import type { ForecastSettings, Param, Segment, Severity, SimState, Thresholds } from './types';
import { villageForecast, type VillageForecast } from './forecast';

export interface NodeEval {
  id: string;
  villageId: string;
  status: Severity;
  qualityStatus: Severity;
  hydraulicStatus: Severity;
  risk: number;
  params: Record<Param, ParamEval & { value: number }>;
  drivers: string[];
}

export interface VillageDerived {
  id: string;
  status: Severity;
  qualityStatus: Severity;
  hydraulicStatus: Severity;
  qualityRisk: number;
  worstNodeId: string;
  nodes: NodeEval[];
  supplyKL: number;
  demandKL: number;
  lpcd: number;
  fulfilledPct: number;
  gapKL: number;
  supplyStatus: Severity;
  equityScore: number;
  equityStatus: Severity;
  healthPriority: number;
  healthStatus: Severity;
  healthComponents: { water: number; trend: number; supply: number };
  caseTrendRatio: number;
  recentCasesPer10k: number;
  baselineCasesPer10k: number;
  forecast: VillageForecast;
  drivers: string[];
}

export type LossClass = 'normal' | 'uncertainty' | 'leak' | 'unauthorised' | 'disruption' | 'unmonitored';
export interface SegmentDerived {
  id: string;
  kind: Segment['kind'];
  upstream: number;
  downstream: number;
  authorised: number;
  loss: number;
  lossPct: number;
  pressureRatio: number;
  classification: LossClass;
  severity: Severity;
  color: 'green' | 'amber' | 'red' | 'grey';
  unit: string;
  note: string;
}

export interface DistrictDerived {
  id: string;
  name: string;
  population: number;
  villages: number;
  sensors: number;
  supplyMLD: number;
  demandMLD: number;
  avgLpcd: number;
  qualityStatus: Severity;
  qualityRiskAvg: number;
  counts: { normal: number; warning: number; critical: number };
  criticalAlerts: number;
  pipelineStatus: Severity;
  lossPct: number;
  lossMLD: number;
  equityScore: number;
  gini: number;
  underservedPop: number;
  deficitMLD: number;
  healthHigh: number;
}

export interface Derived {
  nodes: Record<string, NodeEval>;
  villages: Record<string, VillageDerived>;
  segments: Record<string, SegmentDerived>;
  districts: Record<string, DistrictDerived>;
  kpi: {
    villages: number;
    sensors: number;
    population: number;
    supplyMLD: number;
    demandMLD: number;
    avgLpcd: number;
    safeVillages: number;
    qualityAlertVillages: number;
    shortageVillages: number;
    leakAlerts: number;
    healthHigh: number;
    gini: number;
  };
}

export function evalNode(readings: Record<Param, number>, baselineFlow: number, th: Thresholds, fault = false): Omit<NodeEval, 'id' | 'villageId'> {
  const params = {} as NodeEval['params'];
  let sum = 0;
  let q: Severity = 'normal';
  let h: Severity = 'normal';
  let floor = 0;
  const drivers: string[] = [];
  for (const p of [...QUALITY_PARAMS, ...HYDRAULIC_PARAMS]) {
    const e = evalParam(p, readings[p], th, baselineFlow);
    params[p] = { ...e, value: readings[p] };
    sum += RISK_WEIGHTS[p] * e.s;
    if (e.severity !== 'normal') {
      const info = PARAM_INFO[p];
      drivers.push(`${(e.direction === 'low' ? info.low : info.high)?.title ?? info.label} (${readings[p]} ${info.unit})`);
      if (e.severity === 'critical') floor = Math.max(floor, 70 + 25 * clamp((e.s - 0.75) / 0.25, 0, 1));
      else floor = Math.max(floor, 35 + 30 * clamp((e.s - 0.4) / 0.3, 0, 1));
    }
    if (QUALITY_PARAMS.includes(p)) q = worst(q, e.severity);
    else h = worst(h, e.severity);
  }
  // ORP is a supporting indicator: on its own it can raise to warning only.
  if (params.orp.severity === 'critical' && params.chlorine.severity === 'normal') q = worst(params.ph.severity, 'warning');
  if (fault) drivers.push('Sensor fault flagged — readings uncertain');
  const risk = round(clamp(Math.max(sum, floor), 0, 100), 1);
  return { status: worst(q, h), qualityStatus: q, hydraulicStatus: h, risk, params, drivers };
}

function gini(values: { x: number; w: number }[]) {
  const tot = values.reduce((a, b) => a + b.w, 0);
  const mean = values.reduce((a, b) => a + b.x * b.w, 0) / Math.max(1, tot);
  if (mean <= 0) return 0;
  let s = 0;
  for (const a of values) for (const b of values) s += a.w * b.w * Math.abs(a.x - b.x);
  return round(s / (2 * tot * tot * mean), 3);
}

export function computeDerived(state: SimState, th: Thresholds, fc: ForecastSettings): Derived {
  const nodes: Derived['nodes'] = {};
  for (const id in state.nodes) {
    const n = state.nodes[id];
    nodes[id] = { id, villageId: n.villageId, ...evalNode(n.current, n.baseline.flow, th, n.fault) };
  }

  // ---- pipeline segments (water balance) ----
  const segments: Derived['segments'] = {};
  for (const seg of state.segments) segments[seg.id] = segmentBalance(state, seg, th, nodes);

  // ---- villages ----
  const villages: Derived['villages'] = {};
  for (const vid of state.villageOrder) {
    const v = state.villages[vid];
    const ne = v.nodeIds.map((n) => nodes[n]);
    const worstNode = ne.reduce((a, b) => (b.risk > a.risk ? b : a), ne[0]);
    const inlet = state.nodes[v.nodeIds[0]];
    const supplyKL = (inlet.current.flow * v.supplyHours * 60) / 1000;
    const effectiveKL = supplyKL * (v.supplyDaysPerWeek / 7);
    const demandKL = (v.population * th.lpcdNorm) / 1000 + v.institutionalKL;
    const lpcd = v.population > 0 ? (effectiveKL * 1000) / v.population : 0;
    const fulfilledPct = clamp((lpcd / th.lpcdNorm) * 100, 0, 200);
    const supplyStatus: Severity = fulfilledPct < th.lpcdCritPct ? 'critical' : fulfilledPct < th.lpcdWarnPct ? 'warning' : 'normal';
    const qualityStatus = ne.reduce<Severity>((a, b) => worst(a, b.qualityStatus), 'normal');
    const hydraulicStatus = ne.reduce<Severity>((a, b) => worst(a, b.hydraulicStatus), 'normal');
    const qualityRisk = worstNode.risk;

    // Equity score (0–100): adequacy, supply days, reliability, quality
    const adequacy = clamp(lpcd / th.lpcdNorm, 0, 1);
    const equityScore = round(100 * (0.55 * adequacy + 0.15 * (v.supplyDaysPerWeek / 7) + 0.15 * v.reliability + 0.15 * (1 - qualityRisk / 100)), 1);
    const equityStatus: Severity = fulfilledPct < th.lpcdCritPct ? 'critical' : fulfilledPct < th.lpcdWarnPct ? 'warning' : 'normal';

    // Health surveillance priority (early-warning, NOT diagnosis)
    const weeks = state.health[vid];
    const recent = (weeks[12].diarrhoea + weeks[11].diarrhoea + (state.todayCases[vid] ?? 0)) / 2;
    const base = weeks.slice(3, 10).reduce((a, w) => a + w.diarrhoea, 0) / 7;
    const per10k = (x: number) => (v.population > 0 ? (x / v.population) * 10000 : 0);
    const ratio = (recent + 0.5) / (base + 0.5);
    const trendScore = clamp(((ratio - 1) / 1.5) * 100, 0, 100);
    let water = 0;
    for (const n of ne) {
      const p = n.params;
      water = Math.max(water, 100 * Math.max(p.chlorine.s, p.turbidity.s, 0.75 * p.ph.s, 0.5 * p.orp.s));
    }
    const supplyStress = clamp(((th.lpcdWarnPct - fulfilledPct) / th.lpcdWarnPct) * 100, 0, 100) * 0.6 + (v.supplyHours < 8 ? 40 : 0);
    const healthPriority = round(clamp(0.5 * water + 0.35 * trendScore + 0.15 * clamp(supplyStress, 0, 100), 0, 100), 1);
    const healthStatus: Severity = healthPriority >= th.healthCrit ? 'critical' : healthPriority >= th.healthWarn ? 'warning' : 'normal';

    const forecast = villageForecast(state, vid, fc, supplyKL * (v.supplyDaysPerWeek / 7));
    const drivers = [...new Set(ne.flatMap((n) => n.drivers))];
    if (supplyStatus !== 'normal') drivers.push(`Supply ${round(lpcd, 0)} LPCD (${round(fulfilledPct, 0)}% of ${th.lpcdNorm} LPCD norm)`);

    villages[vid] = {
      id: vid,
      status: worst(worst(qualityStatus, hydraulicStatus), supplyStatus),
      qualityStatus,
      hydraulicStatus,
      qualityRisk,
      worstNodeId: worstNode.id,
      nodes: ne,
      supplyKL: round(effectiveKL, 1),
      demandKL: round(demandKL, 1),
      lpcd: round(lpcd, 1),
      fulfilledPct: round(fulfilledPct, 1),
      gapKL: round(Math.max(0, demandKL - effectiveKL), 1),
      supplyStatus,
      equityScore,
      equityStatus,
      healthPriority,
      healthStatus,
      healthComponents: { water: round(water, 1), trend: round(trendScore, 1), supply: round(clamp(supplyStress, 0, 100), 1) },
      caseTrendRatio: round(ratio, 2),
      recentCasesPer10k: round(per10k(recent), 1),
      baselineCasesPer10k: round(per10k(base), 1),
      forecast,
      drivers,
    };
  }

  // ---- districts ----
  const districts: Derived['districts'] = {};
  for (const d of state.districts) {
    const vids = state.villageOrder.filter((v) => state.villages[v].districtId === d.id);
    const vd = vids.map((v) => villages[v]);
    const pop = vids.reduce((a, v) => a + state.villages[v].population, 0);
    const supply = vd.reduce((a, v) => a + v.supplyKL, 0) / 1000;
    const demand = vd.reduce((a, v) => a + v.demandKL, 0) / 1000;
    const counts = { normal: 0, warning: 0, critical: 0 };
    vd.forEach((v) => counts[v.qualityStatus]++);
    const segs = state.segments.filter((s) => s.districtId === d.id && (s.kind === 'distribution' || s.kind === 'transmission'));
    const pipelineStatus = segs.reduce<Severity>((a, s) => worst(a, segments[s.id].severity), 'normal');
    const t = segments[`seg-t-${d.id}`];
    const distLossMLD = segs
      .filter((s) => s.kind === 'distribution')
      .reduce((a, s) => a + (Math.max(0, segments[s.id].loss) * state.villages[s.villageId!].supplyHours * 60) / 1e6, 0);
    const lossMLD = (t ? Math.max(0, t.loss) : 0) + distLossMLD;
    const inflow = t ? t.upstream : supply;
    districts[d.id] = {
      id: d.id,
      name: d.name,
      population: pop,
      villages: vids.length,
      sensors: vids.reduce((a, v) => a + state.villages[v].nodeIds.length, 0),
      supplyMLD: round(supply, 3),
      demandMLD: round(demand, 3),
      avgLpcd: round(pop > 0 ? (supply * 1e6) / pop : 0, 1),
      qualityStatus: vd.reduce<Severity>((a, v) => worst(a, v.qualityStatus), 'normal'),
      qualityRiskAvg: round(vd.reduce((a, v) => a + v.qualityRisk, 0) / Math.max(1, vd.length), 1),
      counts,
      criticalAlerts: 0, // filled in by alerts layer
      pipelineStatus,
      lossPct: round(inflow > 0 ? (lossMLD / inflow) * 100 : 0, 1),
      lossMLD: round(lossMLD, 3),
      equityScore: round(vd.reduce((a, v, i) => a + v.equityScore * state.villages[vids[i]].population, 0) / Math.max(1, pop), 1),
      gini: gini(vd.map((v, i) => ({ x: v.lpcd, w: state.villages[vids[i]].population }))),
      underservedPop: vd.reduce((a, v, i) => a + (v.supplyStatus !== 'normal' ? state.villages[vids[i]].population : 0), 0),
      deficitMLD: round(vd.reduce((a, v) => a + v.gapKL, 0) / 1000, 3),
      healthHigh: vd.filter((v) => v.healthStatus !== 'normal').length,
    };
  }

  const all = Object.values(villages);
  const pop = state.villageOrder.reduce((a, v) => a + state.villages[v].population, 0);
  const supplyMLD = all.reduce((a, v) => a + v.supplyKL, 0) / 1000;
  return {
    nodes,
    villages,
    segments,
    districts,
    kpi: {
      villages: all.length,
      sensors: Object.keys(state.nodes).length,
      population: pop,
      supplyMLD: round(supplyMLD, 2),
      demandMLD: round(all.reduce((a, v) => a + v.demandKL, 0) / 1000, 2),
      avgLpcd: round((supplyMLD * 1e6) / Math.max(1, pop), 1),
      safeVillages: all.filter((v) => v.qualityStatus === 'normal').length,
      qualityAlertVillages: all.filter((v) => v.qualityStatus !== 'normal').length,
      shortageVillages: all.filter((v) => v.supplyStatus !== 'normal').length,
      leakAlerts: Object.values(segments).filter((s) => s.classification === 'leak' || s.classification === 'unauthorised').length,
      healthHigh: all.filter((v) => v.healthStatus !== 'normal').length,
      gini: gini(all.map((v) => ({ x: v.lpcd, w: state.villages[v.id].population }))),
    },
  };
}

/**
 * Water balance:  loss = upstream inflow − downstream measured outflow − accounted authorised consumption.
 * The classifier only sees what a real operator would see (flows, pressure, sensor health), never the
 * hidden physics truth. It deliberately separates suspected leakage, possible unauthorised draw-off,
 * measurement uncertainty and upstream supply disruption.
 */
export function segmentBalance(state: SimState, seg: Segment, th: Thresholds, nodes: Record<string, NodeEval>): SegmentDerived {
  if (seg.kind === 'intake')
    return { id: seg.id, kind: seg.kind, upstream: seg.baseUpstream, downstream: seg.baseUpstream, authorised: 0, loss: 0, lossPct: 0, pressureRatio: 1, classification: 'unmonitored', severity: 'normal', color: 'grey', unit: 'MLD', note: 'Raw-water conveyance — not instrumented in this simulation.' };

  if (seg.kind === 'service') {
    const to = state.nodes[seg.toId];
    const ne = nodes[seg.toId];
    const color = to.fault ? 'grey' : ne.hydraulicStatus === 'critical' ? 'red' : ne.hydraulicStatus === 'warning' ? 'amber' : 'green';
    return { id: seg.id, kind: seg.kind, upstream: state.nodes[seg.fromId].current.flow, downstream: to.current.flow, authorised: 0, loss: 0, lossPct: 0, pressureRatio: to.current.pressure / to.baseline.pressure, classification: to.fault ? 'unmonitored' : 'normal', severity: ne.hydraulicStatus, color, unit: 'L/min', note: to.fault ? 'Downstream sensor faulty.' : 'In-village service line.' };
  }

  if (seg.kind === 'transmission') {
    const up = seg.upstreamOverride ?? seg.baseUpstream;
    const down = up * (1 - state.transmissionLoss[seg.districtId] - seg.authorisedPct / 100);
    const auth = up * (seg.authorisedPct / 100);
    const loss = up - down - auth;
    const lossPct = up > 0 ? (loss / up) * 100 : 0;
    // Trunk-main pressure falls roughly in proportion to the excess loss (simulated bulk pressure logger).
    const pr = 1 - 1.5 * Math.max(0, state.transmissionLoss[seg.districtId] - seg.baseLossFactor);
    const { classification, severity } = classify(lossPct, pr, false, false, th);
    return { id: seg.id, kind: seg.kind, upstream: round(up, 3), downstream: round(down, 3), authorised: round(auth, 3), loss: round(loss, 3), lossPct: round(lossPct, 1), pressureRatio: round(pr, 2), classification, severity, color: colorOf(severity, classification), unit: 'MLD', note: 'Bulk meters at WTP outlet and district reservoir inlet (simulated).' };
  }

  // distribution: district reservoir → village inlet
  const v = state.villages[seg.villageId!];
  const inlet = state.nodes[seg.toId];
  const hf = hydraulicFactor(state, v.id);
  const t = state.segments.find((s) => s.id === `seg-t-${v.districtId}`);
  const transF = t ? (1 - state.transmissionLoss[v.districtId]) / (1 - t.baseLossFactor) : 1;
  const hour = new Date(state.simTime).getHours() + new Date(state.simTime).getMinutes() / 60;
  const up = seg.upstreamOverride !== undefined ? seg.upstreamOverride : seg.baseUpstream * transF * diurnal(hour);
  const down = inlet.current.flow;
  const auth = up * (seg.authorisedPct / 100);
  const loss = up - down - auth;
  const lossPct = up > 0 ? (loss / up) * 100 : 0;
  const pressureRatio = inlet.current.pressure / Math.max(0.01, inlet.baseline.pressure);
  const disruption = up < 0.6 * seg.baseUpstream && lossPct < th.lossTolerancePct + th.lossUncertaintyPct;
  const { classification, severity } = classify(lossPct, pressureRatio, inlet.fault, disruption, th);
  void hf;
  const notes: Record<LossClass, string> = {
    normal: 'Water balance within tolerance.',
    uncertainty: inlet.fault ? 'Downstream sensor fault — balance cannot be trusted; recalibrate before concluding.' : 'Gap is within the measurement-uncertainty band — verify meter calibration before field action.',
    leak: 'Balance gap with falling downstream pressure — consistent with a physical leak/burst.',
    unauthorised: 'Balance gap while pressure is maintained — consistent with unaccounted draw-off (e.g. unauthorised connection) or unmetered authorised use. Field verification required; not proof of theft.',
    disruption: 'Upstream supply itself is reduced (pump/source issue) — this is a supply disruption, not a loss.',
    unmonitored: '',
  };
  return { id: seg.id, kind: seg.kind, upstream: round(up, 1), downstream: round(down, 1), authorised: round(auth, 1), loss: round(loss, 1), lossPct: round(lossPct, 1), pressureRatio: round(pressureRatio, 2), classification, severity, color: colorOf(severity, classification), unit: 'L/min', note: notes[classification] };
}

function classify(lossPct: number, pressureRatio: number, fault: boolean, disruption: boolean, th: Thresholds): { classification: LossClass; severity: Severity } {
  if (disruption) return { classification: 'disruption', severity: 'warning' };
  if (fault && lossPct > th.lossTolerancePct) return { classification: 'uncertainty', severity: 'warning' };
  if (lossPct <= th.lossTolerancePct) return { classification: 'normal', severity: 'normal' };
  if (lossPct <= th.lossTolerancePct + th.lossUncertaintyPct) return { classification: 'uncertainty', severity: 'warning' };
  const severity: Severity = lossPct >= th.lossCritPct ? 'critical' : 'warning';
  return { classification: pressureRatio < 0.8 ? 'leak' : 'unauthorised', severity };
}

function colorOf(sev: Severity, c: LossClass): SegmentDerived['color'] {
  if (c === 'unmonitored') return 'grey';
  return sev === 'critical' ? 'red' : sev === 'warning' ? 'amber' : 'green';
}

export const LOSS_LABEL: Record<LossClass, string> = {
  normal: 'Normal',
  uncertainty: 'Measurement uncertainty',
  leak: 'Suspected leakage',
  unauthorised: 'Possible unauthorised draw-off',
  disruption: 'Upstream supply disruption',
  unmonitored: 'Unmonitored',
};

export { sevRank };
