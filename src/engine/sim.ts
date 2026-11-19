// Simulation physics: 15-minute ticks, abnormal events, and user-driven parameter changes.
// Functions return new state objects (shallow copies of what changed) so React re-renders.

import { DAY, STEP_MIN, type GenPlan } from './generator';
import { clamp, gauss, mulberry32, round, type RNG } from './rng';
import { evalParam, orpFrom } from './thresholds';
import type { ChangeEvent, EventType, Param, Readings, Segment, SensorNode, SimEvent, SimState, Thresholds } from './types';

let rng: RNG = mulberry32(Date.now() & 0xffffffff);
export function reseedTickRng(seed: number) {
  rng = mulberry32(seed ^ 0x5bd1e995);
}

const uid = () => Math.random().toString(36).slice(2, 10);

export function segOf(state: SimState, villageId: string): Segment | undefined {
  return state.segments.find((s) => s.id === `seg-d-${villageId}`);
}
export function transSegOf(state: SimState, districtId: string): Segment | undefined {
  return state.segments.find((s) => s.id === `seg-t-${districtId}`);
}

/** Ratio of current to baseline hydraulic delivery for a village (physics truth). */
export function hydraulicFactor(state: SimState, villageId: string) {
  const v = state.villages[villageId];
  const seg = segOf(state, villageId);
  const t = transSegOf(state, v.districtId);
  const transF = t ? (1 - state.transmissionLoss[v.districtId]) / (1 - t.baseLossFactor) : 1;
  let upF = transF;
  if (seg?.upstreamOverride !== undefined) upF = seg.upstreamOverride / seg.baseUpstream;
  const a = (seg?.authorisedPct ?? 0) / 100;
  const segF = seg ? (1 - a - seg.lossFactor) / (1 - a - seg.baseLossFactor) : 1;
  const excess = seg ? Math.max(0, seg.lossFactor - seg.baseLossFactor) : 0;
  const pressF = seg?.lossKind === 'leak' ? 1 - 2.2 * excess : 1 - 0.25 * excess;
  return { flow: Math.max(0, upF * segF), pressure: clamp(pressF * Math.sqrt(Math.min(1.2, Math.max(0, upF))), 0.05, 1.3) };
}

function targetFor(state: SimState, node: SensorNode, p: Param, hour: number): number {
  const b = node.baseline[p];
  if (p === 'flow') {
    const hf = hydraulicFactor(state, node.villageId).flow;
    return b * hf * diurnal(hour);
  }
  if (p === 'pressure') return b * hydraulicFactor(state, node.villageId).pressure;
  if (p === 'chlorine') return b * (1 - 0.04 * Math.sin((2 * Math.PI * (hour - 14)) / 24));
  return b;
}

/** Demand-driven diurnal flow pattern; applies equally to upstream and downstream meters. */
export const diurnal = (hour: number) => 1 + 0.05 * Math.sin((2 * Math.PI * (hour - 8)) / 12);

const NOISE: Record<Param, number> = { ph: 0.03, tds: 4, turbidity: 0.03, chlorine: 0.012, orp: 6, flow: 0.012, pressure: 0.015 };

export function advanceNode(state: SimState, node: SensorNode, hour: number): SensorNode {
  const cur: Readings = { ...node.current };
  const params: Param[] = ['ph', 'tds', 'turbidity', 'chlorine', 'flow', 'pressure'];
  for (const p of params) {
    if (node.overrides[p]) continue;
    const target = targetFor(state, node, p, hour);
    const scale = p === 'flow' || p === 'pressure' ? Math.max(1, target) : 1;
    let next = cur[p] + 0.4 * (target - cur[p]) + gauss(rng) * NOISE[p] * scale;
    if (node.fault && (p === 'flow' || p === 'turbidity')) next = target * (1 + gauss(rng) * 0.25);
    cur[p] = Math.max(0, next);
  }
  if (!node.overrides.orp) cur.orp = orpFrom(cur.chlorine, cur.ph, cur.turbidity) + gauss(rng) * NOISE.orp;
  return { ...node, prev: node.current, current: roundReadings(cur) };
}

function roundReadings(r: Readings): Readings {
  return {
    ph: round(r.ph, 2),
    tds: Math.round(r.tds),
    turbidity: round(r.turbidity, 2),
    chlorine: round(r.chlorine, 3),
    orp: Math.round(r.orp),
    flow: round(r.flow, 1),
    pressure: round(r.pressure, 2),
  };
}

const BUFFER_CAP = 480;
function pushSample(buf: SimState['liveBuffer'], id: string, t: number, v: Readings) {
  const arr = buf[id] ? buf[id].slice(-BUFFER_CAP + 1) : [];
  arr.push({ t, v });
  buf[id] = arr;
}

export function tick(state: SimState, th: Thresholds): SimState {
  const simTime = state.simTime + STEP_MIN * 60_000;
  const hour = new Date(simTime).getHours() + new Date(simTime).getMinutes() / 60;
  const nodes: SimState['nodes'] = {};
  const liveBuffer = { ...state.liveBuffer };
  for (const id in state.nodes) {
    const n = advanceNode(state, state.nodes[id], hour);
    nodes[id] = n;
    pushSample(liveBuffer, id, simTime, n.current);
  }

  // Lagged synthetic health response: sustained poor disinfection slowly raises suspected cases.
  const todayCases = { ...state.todayCases };
  for (const vid of state.villageOrder) {
    const v = state.villages[vid];
    let exposure = 0;
    for (const nid of v.nodeIds) {
      const c = nodes[nid].current;
      const s = Math.max(evalParam('chlorine', c.chlorine, th).s, evalParam('turbidity', c.turbidity, th).s);
      exposure = Math.max(exposure, s);
    }
    const perDay = (v.population / 10000) * 3 * Math.max(0, exposure - 0.35);
    const lam = (perDay * STEP_MIN) / (60 * 24);
    if (lam > 0 && rng() < lam) todayCases[vid] = (todayCases[vid] ?? 0) + 1;
  }

  let next: SimState = { ...state, simTime, nodes, liveBuffer, todayCases };
  // Day rollover: roll the 30-day supply history forward using live readings.
  if (Math.floor(simTime / DAY) !== Math.floor(state.simTime / DAY)) next = rollDay(next);
  return next;
}

function rollDay(state: SimState): SimState {
  const supplyHistory: SimState['supplyHistory'] = {};
  for (const vid of state.villageOrder) {
    const v = state.villages[vid];
    const hist = state.supplyHistory[vid];
    const last = hist[hist.length - 1];
    const inlet = state.nodes[v.nodeIds[0]];
    const supplied = (inlet.current.flow * v.supplyHours * 60) / 1000;
    const day = new Date(state.simTime - DAY).toISOString().slice(0, 10);
    supplyHistory[vid] = [
      ...hist.slice(1),
      {
        ...last,
        day,
        suppliedKL: round(supplied, 1),
        demandKL: round((v.population * 100) / 1000 + v.institutionalKL, 1),
        interrupted: supplied < 0.6 * ((inlet.baseline.flow * v.supplyHours * 60) / 1000),
      },
    ];
  }
  return { ...state, supplyHistory };
}

// ---------------------------------------------------------------- user actions

export function setNodeParam(state: SimState, nodeId: string, p: Param, value: number): { state: SimState; change: ChangeEvent } {
  const node = state.nodes[nodeId];
  const old = node.current[p];
  const cur = { ...node.current, [p]: value };
  if (p !== 'orp' && !node.overrides.orp && (p === 'chlorine' || p === 'ph' || p === 'turbidity'))
    cur.orp = Math.round(orpFrom(cur.chlorine, cur.ph, cur.turbidity));
  const n: SensorNode = { ...node, prev: node.current, current: roundReadings(cur), overrides: { ...node.overrides, [p]: true } };
  const liveBuffer = { ...state.liveBuffer };
  pushSample(liveBuffer, nodeId, state.simTime, n.current);
  return {
    state: { ...state, nodes: { ...state.nodes, [nodeId]: n }, liveBuffer },
    change: { id: uid(), sim: state.simTime, wall: Date.now(), nodeId, villageId: node.villageId, param: p, oldValue: old, newValue: value, source: 'user' },
  };
}

export function restoreNode(state: SimState, nodeId: string, params?: Param[]): { state: SimState; changes: ChangeEvent[] } {
  const node = state.nodes[nodeId];
  const hour = new Date(state.simTime).getHours();
  const overrides = { ...node.overrides };
  const cur = { ...node.current };
  const changes: ChangeEvent[] = [];
  const list = params ?? (Object.keys(node.overrides) as Param[]);
  for (const p of list) {
    delete overrides[p];
    const target = round(targetFor(state, node, p, hour), 3);
    changes.push({ id: uid(), sim: state.simTime, wall: Date.now(), nodeId, villageId: node.villageId, param: p, oldValue: cur[p], newValue: target, source: 'user' });
    cur[p] = target;
  }
  if (!overrides.orp) cur.orp = Math.round(orpFrom(cur.chlorine, cur.ph, cur.turbidity));
  const n: SensorNode = { ...node, prev: node.current, current: roundReadings(cur), overrides };
  const liveBuffer = { ...state.liveBuffer };
  pushSample(liveBuffer, nodeId, state.simTime, n.current);
  return { state: { ...state, nodes: { ...state.nodes, [nodeId]: n }, liveBuffer }, changes };
}

export function setVillagePopulation(state: SimState, vid: string, population: number): SimState {
  const v = state.villages[vid];
  return { ...state, villages: { ...state.villages, [vid]: { ...v, population: Math.max(0, Math.round(population)) } } };
}

export function setSegment(state: SimState, segId: string, patch: Partial<Segment>): SimState {
  return { ...state, segments: state.segments.map((s) => (s.id === segId ? { ...s, ...patch } : s)) };
}

/** Snap non-overridden hydraulic readings of a village to the new physics immediately (used when paused). */
export function settleVillage(state: SimState, vid: string): SimState {
  const v = state.villages[vid];
  const hour = new Date(state.simTime).getHours();
  const nodes = { ...state.nodes };
  for (const nid of v.nodeIds) {
    const n = nodes[nid];
    const cur = { ...n.current };
    for (const p of ['flow', 'pressure', 'chlorine', 'turbidity', 'tds', 'ph'] as Param[]) if (!n.overrides[p]) cur[p] = targetFor(state, n, p, hour);
    if (!n.overrides.orp) cur.orp = orpFrom(cur.chlorine, cur.ph, cur.turbidity);
    nodes[nid] = { ...n, prev: n.current, current: roundReadings(cur) };
  }
  return { ...state, nodes };
}

// ---------------------------------------------------------------- abnormal events

export const EVENT_LABELS: Record<EventType, { label: string; target: 'village' | 'district' | 'node'; description: string }> = {
  'chlorinator-failure': { label: 'Chlorinator failure', target: 'village', description: 'Dosing stops; residual chlorine decays across the village network.' },
  'turbidity-spike': { label: 'Turbidity spike', target: 'village', description: 'Suspended solids enter the supply (e.g., filter breakthrough or pipe ingress).' },
  'tds-intrusion': { label: 'High-TDS intrusion', target: 'village', description: 'Mineralised groundwater blends into the supply.' },
  'ph-excursion': { label: 'pH excursion', target: 'village', description: 'Chemical dosing error pushes pH out of range.' },
  'pipeline-leak': { label: 'Distribution pipeline leak', target: 'village', description: 'Physical leak between the district reservoir and the village (pressure drops).' },
  'illegal-tapping': { label: 'Unauthorised draw-off', target: 'village', description: 'Unaccounted withdrawal on the distribution main (pressure largely maintained).' },
  'main-burst': { label: 'Transmission main burst', target: 'district', description: 'Large loss on the WTP → district reservoir main; all downstream villages lose supply.' },
  'pump-failure': { label: 'Pump failure', target: 'village', description: 'Upstream pumping stops; both upstream and downstream flows fall (supply disruption, not loss).' },
  'sensor-fault': { label: 'Sensor fault', target: 'node', description: 'A node reports erratic flow/turbidity (measurement uncertainty).' },
};

export function applyEvent(state: SimState, type: EventType, targetId: string, sim = state.simTime): SimState {
  let s = { ...state, nodes: { ...state.nodes }, segments: [...state.segments], transmissionLoss: { ...state.transmissionLoss } };
  const patches: SimEvent['patches'] = [];
  const nodePatch = (nid: string, field: Param, value: number) => {
    const n = s.nodes[nid];
    patches.push({ kind: 'node', id: nid, field, original: n.baseline[field], value });
    const baseline = { ...n.baseline, [field]: value };
    const current = { ...n.current, [field]: n.overrides[field] ? n.current[field] : value };
    if (!n.overrides.orp) current.orp = Math.round(orpFrom(current.chlorine, current.ph, current.turbidity));
    s.nodes[nid] = { ...n, baseline, current };
  };
  const segPatch = (segId: string, field: 'lossFactor' | 'upstreamOverride', value: number, kind?: Segment['lossKind']) => {
    const i = s.segments.findIndex((x) => x.id === segId);
    if (i < 0) return;
    const seg = s.segments[i];
    const original = field === 'lossFactor' ? seg.lossFactor : seg.upstreamOverride ?? -1;
    patches.push({ kind: 'segment', id: segId, field: kind ? `${field}:${kind}` : field, original, value });
    s.segments[i] = { ...seg, [field]: value, ...(kind ? { lossKind: kind } : {}) };
  };

  const v = s.villages[targetId];
  let label = '';
  switch (type) {
    case 'chlorinator-failure':
      v.nodeIds.forEach((nid, i) => nodePatch(nid, 'chlorine', round([0.14, 0.09, 0.06][Math.min(i, 2)] * (s.nodes[nid].kind === 'tap' ? 0.9 : 1), 2)));
      label = v.name;
      break;
    case 'turbidity-spike':
      v.nodeIds.forEach((nid) => nodePatch(nid, 'turbidity', round(6 + rng() * 4, 1)));
      label = v.name;
      break;
    case 'tds-intrusion':
      v.nodeIds.forEach((nid) => nodePatch(nid, 'tds', Math.round(1050 + rng() * 200)));
      label = v.name;
      break;
    case 'ph-excursion':
      v.nodeIds.forEach((nid) => nodePatch(nid, 'ph', round(9.0 + rng() * 0.4, 2)));
      label = v.name;
      break;
    case 'pipeline-leak':
      segPatch(`seg-d-${targetId}`, 'lossFactor', 0.3, 'leak');
      label = `${v.name} distribution main`;
      break;
    case 'illegal-tapping':
      segPatch(`seg-d-${targetId}`, 'lossFactor', 0.17, 'tap');
      label = `${v.name} distribution main`;
      break;
    case 'pump-failure': {
      const seg = segOf(s, targetId)!;
      segPatch(seg.id, 'upstreamOverride', round(seg.baseUpstream * 0.3, 1));
      label = `${v.name} feeder pump`;
      break;
    }
    case 'main-burst': {
      patches.push({ kind: 'transmission', id: targetId, field: 'loss', original: s.transmissionLoss[targetId], value: 0.34 });
      s.transmissionLoss[targetId] = 0.34;
      label = `${s.districts.find((d) => d.id === targetId)?.name} transmission main`;
      break;
    }
    case 'sensor-fault': {
      const n = s.nodes[targetId];
      patches.push({ kind: 'node', id: targetId, field: 'fault', original: 0, value: 1 });
      s.nodes[targetId] = { ...n, fault: true };
      label = `${n.id} sensor`;
      break;
    }
  }
  const ev: SimEvent = { id: uid(), type, targetId, label, sim, active: true, patches };
  s = { ...s, events: [...s.events, ev] };
  // Snap hydraulics so the effect is visible immediately even when the clock is paused.
  const affected = type === 'main-burst' ? s.villageOrder.filter((x) => s.villages[x].districtId === targetId) : type === 'sensor-fault' ? [] : [targetId];
  for (const vid of affected) s = settleVillage(s, vid);
  return s;
}

export function resolveEvent(state: SimState, eventId: string): SimState {
  const ev = state.events.find((e) => e.id === eventId);
  if (!ev || !ev.active) return state;
  let s = { ...state, nodes: { ...state.nodes }, segments: [...state.segments], transmissionLoss: { ...state.transmissionLoss } };
  const touchedVillages = new Set<string>();
  for (const p of [...ev.patches].reverse()) {
    if (p.kind === 'node') {
      const n = s.nodes[p.id];
      touchedVillages.add(n.villageId);
      if (p.field === 'fault') s.nodes[p.id] = { ...n, fault: false };
      else s.nodes[p.id] = { ...n, baseline: { ...n.baseline, [p.field]: p.original } };
    } else if (p.kind === 'segment') {
      const i = s.segments.findIndex((x) => x.id === p.id);
      const [field] = p.field.split(':');
      const seg = s.segments[i];
      if (seg.villageId) touchedVillages.add(seg.villageId);
      if (field === 'lossFactor') s.segments[i] = { ...seg, lossFactor: p.original, lossKind: 'none' };
      else s.segments[i] = { ...seg, upstreamOverride: p.original < 0 ? undefined : p.original };
    } else {
      s.transmissionLoss[p.id] = p.original;
      s.villageOrder.filter((x) => s.villages[x].districtId === p.id).forEach((x) => touchedVillages.add(x));
    }
  }
  s.events = s.events.map((e) => (e.id === eventId ? { ...e, active: false } : e));
  for (const vid of touchedVillages) s = settleVillage(s, vid);
  return s;
}

/** Seed the starting environment with a handful of realistic, resolvable abnormal conditions. */
export function seedEvents(state: SimState, plan: GenPlan): SimState {
  let s = state;
  const t0 = state.simTime - 2 * DAY;
  for (const v of plan.chronic.chlorine) s = applyEvent(s, 'chlorinator-failure', v, t0);
  for (const v of plan.chronic.turbidity) s = applyEvent(s, 'turbidity-spike', v, t0);
  for (const v of plan.chronic.tds) s = applyEvent(s, 'tds-intrusion', v, t0);
  for (const seg of plan.chronic.leakSeg) s = applyEvent(s, 'pipeline-leak', seg.replace('seg-d-', ''), t0);
  for (const seg of plan.chronic.tapSeg) s = applyEvent(s, 'illegal-tapping', seg.replace('seg-d-', ''), t0);
  for (const n of plan.chronic.fault) s = applyEvent(s, 'sensor-fault', n, t0);
  return s;
}
