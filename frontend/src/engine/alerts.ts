// Alert & notification engine. Alerts are never hand-authored: each one is derived from a live
// condition in the simulated data. When the condition disappears the alert auto-resolves.

import type { Derived } from './compute';
import { LOSS_LABEL } from './compute';
import { PARAM_INFO } from './thresholds';
import { round } from './rng';
import type { AlertRecord, ChangeEvent, Condition, Param, SimState, Thresholds } from './types';

const uid = () => Math.random().toString(36).slice(2, 10);

export function buildConditions(state: SimState, d: Derived, th: Thresholds): Condition[] {
  const out: Condition[] = [];
  for (const vid of state.villageOrder) {
    const v = state.villages[vid];
    const vd = d.villages[vid];
    for (const nid of v.nodeIds) {
      const node = state.nodes[nid];
      const ne = d.nodes[nid];
      for (const p of Object.keys(ne.params) as Param[]) {
        const e = ne.params[p];
        if (e.severity === 'normal') continue;
        if (p === 'orp' && ne.params.chlorine.severity !== 'normal') continue; // folded into chlorine alert
        const info = PARAM_INFO[p];
        const k = e.direction === 'low' ? info.low : info.high;
        if (!k) continue;
        const title = p === 'flow' && e.severity === 'critical' ? 'Sudden flow drop' : k.title;
        const faultNote = node.fault ? 'SENSOR FAULT FLAGGED — reading may be unreliable; verify before field action. ' : '';
        const ratio = p === 'flow' ? ` (${round((e.value / node.baseline.flow) * 100, 0)}% of baseline ${node.baseline.flow} L/min)` : '';
        out.push({
          key: `q:${nid}:${p}`,
          category: info.category,
          severity: e.severity as 'warning' | 'critical',
          title: `${title} — ${v.name}`,
          villageId: vid,
          districtId: v.districtId,
          nodeId: nid,
          param: p,
          value: e.value,
          unit: info.unit,
          explanation: `${faultNote}${k.meaning} Reading at ${node.label}: ${e.value} ${info.unit}${ratio}. Reference: ${info.standard} Possible causes: ${k.causes.join('; ')}. Possible consequences: ${k.consequences.join('; ')}.`,
          actions: k.actions,
        });
      }
    }
    if (vd.supplyStatus !== 'normal') {
      out.push({
        key: `s:${vid}`,
        category: 'Water supply',
        severity: vd.supplyStatus as 'warning' | 'critical',
        title: `Insufficient LPCD — ${v.name}`,
        villageId: vid,
        districtId: v.districtId,
        param: 'lpcd',
        value: vd.lpcd,
        unit: 'LPCD',
        explanation: `Effective supply is ${vd.lpcd} LPCD (${vd.fulfilledPct}% of the ${th.lpcdNorm} LPCD norm) for ${v.population.toLocaleString('en-IN')} people. Daily gap ≈ ${vd.gapKL} kL. Supply ${v.supplyHours} h/day, ${v.supplyDaysPerWeek} days/week.`,
        actions: ['Check inlet flow and upstream water balance', 'Review valve scheduling and supply hours', 'Prioritise in equity intervention ranking', 'Arrange interim tanker supply if deficit persists'],
      });
    }
    if (vd.healthStatus !== 'normal') {
      const w = state.health[vid];
      const trend = vd.caseTrendRatio > 1.3 ? 'Increasing' : vd.caseTrendRatio < 0.8 ? 'Decreasing' : 'Stable';
      const wn = state.nodes[vd.worstNodeId].current;
      out.push({
        key: `ph:${vid}`,
        category: 'Public health',
        severity: vd.healthStatus as 'warning' | 'critical',
        title: `${vd.healthStatus === 'critical' ? 'PUBLIC HEALTH WATCH' : 'Health surveillance watch'} — ${v.name}`,
        villageId: vid,
        districtId: v.districtId,
        param: 'health',
        value: vd.healthPriority,
        unit: '/100',
        explanation: `Observed conditions: free chlorine ${wn.chlorine} mg/L; turbidity ${wn.turbidity} NTU; pH ${wn.ph}; suspected diarrhoeal cases (synthetic) ${trend.toLowerCase()} — last 2 weeks ${w[11].diarrhoea + w[12].diarrhoea + (state.todayCases[vid] ?? 0)} vs baseline ≈ ${round(vd.baselineCasesPer10k * 2 * (v.population / 10000), 0)}. Priority score ${vd.healthPriority}/100 (water ${vd.healthComponents.water}, case trend ${vd.healthComponents.trend}, supply stress ${vd.healthComponents.supply}). This is an early-warning prioritisation signal — NOT a diagnosis or outbreak confirmation, and it does not establish causation.`,
        actions: ['Conduct immediate confirmatory water sampling (bacteriological + residual chlorine)', 'Inspect chlorination equipment', 'Notify the designated public health officer', 'Initiate appropriate public health surveillance through ASHA/ANM workers'],
      });
    }
    if (vd.supplyStatus === 'normal' && vd.forecast.deficit7Pct > th.forecastDeficitPct) {
      out.push({
        key: `f:${vid}`,
        category: 'Demand forecasting',
        severity: vd.forecast.deficit7Pct > th.forecastDeficitPct * 1.75 ? 'critical' : 'warning',
        title: `Predicted shortage (7-day) — ${v.name}`,
        villageId: vid,
        districtId: v.districtId,
        param: 'forecast',
        value: vd.forecast.deficit7Pct,
        unit: '% deficit',
        explanation: `The illustrative forecast model projects average demand of ${vd.forecast.avg7Demand} kL/day against capacity ${vd.forecast.avg7Capacity} kL/day over the next 7 days (deficit ${vd.forecast.deficit7Pct}%).`,
        actions: ['Plan additional supply hours or allocation', 'Verify forecast inputs (population, temperature, rainfall)', 'Pre-position tanker contingency'],
      });
    }
  }
  for (const seg of state.segments) {
    const sd = d.segments[seg.id];
    if (sd.severity === 'normal' || sd.classification === 'normal' || seg.kind === 'service' || seg.kind === 'intake') continue;
    const v = seg.villageId ? state.villages[seg.villageId] : undefined;
    const where = seg.kind === 'transmission' ? `${state.districts.find((x) => x.id === seg.districtId)?.name} transmission main` : `${v?.name} distribution main`;
    out.push({
      key: `l:${seg.id}`,
      category: sd.classification === 'disruption' ? 'Infrastructure' : 'Water loss',
      severity: sd.severity as 'warning' | 'critical',
      title: `${LOSS_LABEL[sd.classification]} — ${where}`,
      villageId: seg.villageId,
      districtId: seg.districtId,
      segmentId: seg.id,
      param: 'loss',
      value: sd.lossPct,
      unit: '% loss',
      explanation: `Water balance: upstream ${sd.upstream} − downstream ${sd.downstream} − authorised ${sd.authorised} = ${sd.loss} ${sd.unit} (${sd.lossPct}% vs tolerance ${th.lossTolerancePct}%). Downstream pressure at ${round(sd.pressureRatio * 100, 0)}% of baseline. ${sd.note}`,
      actions:
        sd.classification === 'leak'
          ? ['Dispatch field crew to walk the segment; check for wet patches/bursts', 'Isolate segment and repair', 'Check for contaminant ingress after repair (flush + sample)']
          : sd.classification === 'unauthorised'
            ? ['Field verification of connections along the main', 'Cross-check authorised consumption records', 'Verify flow meter calibration before any enforcement action']
            : sd.classification === 'disruption'
              ? ['Check upstream pump station and power supply', 'Inform village operators of reduced supply']
              : ['Recalibrate upstream/downstream meters', 'Re-run water balance after calibration'],
    });
  }
  return out;
}

export interface DiffResult {
  alerts: AlertRecord[];
  raised: AlertRecord[];
  resolved: AlertRecord[];
  escalated: AlertRecord[];
}

export function diffAlerts(prev: AlertRecord[], conds: Condition[], state: SimState, changes: ChangeEvent[]): DiffResult {
  const sim = state.simTime;
  const wall = Date.now();
  const byKey = new Map(conds.map((c) => [c.key, c]));
  const raised: AlertRecord[] = [];
  const resolved: AlertRecord[] = [];
  const escalated: AlertRecord[] = [];
  const activeKeys = new Set<string>();
  const next = prev.map((a) => {
    if (a.status !== 'active') return a;
    const c = byKey.get(a.key);
    if (!c) {
      const r: AlertRecord = { ...a, status: 'resolved', resolvedSim: sim, resolvedWall: wall, updatedSim: sim, history: [...a.history, { sim, wall, severity: 'resolved', value: currentValue(a, state), note: 'Condition cleared — auto-resolved' }] };
      resolved.push(r);
      return r;
    }
    activeKeys.add(a.key);
    if (c.severity !== a.severity) {
      const r: AlertRecord = { ...a, ...c, updatedSim: sim, history: [...a.history, { sim, wall, severity: c.severity, value: c.value, note: c.severity === 'critical' ? 'Escalated to critical' : 'De-escalated to warning' }] };
      if (c.severity === 'critical') escalated.push(r);
      return r;
    }
    if (c.value !== a.value || c.explanation !== a.explanation) return { ...a, value: c.value, explanation: c.explanation, title: c.title };
    return a;
  });
  for (const c of conds) {
    if (activeKeys.has(c.key)) continue;
    let prevValue: number | null = null;
    if (c.nodeId && c.param) {
      const ch = [...changes].reverse().find((x) => x.nodeId === c.nodeId && x.param === c.param);
      prevValue = ch ? ch.oldValue : state.nodes[c.nodeId].prev[c.param as Param] ?? null;
    }
    const rec: AlertRecord = {
      ...c,
      id: uid(),
      status: 'active',
      prevValue,
      createdSim: sim,
      createdWall: wall,
      updatedSim: sim,
      history: [{ sim, wall, severity: c.severity, value: c.value, note: prevValue !== null ? `Raised: ${prevValue} → ${c.value} ${c.unit}` : 'Raised' }],
      acknowledged: false,
      delivery: 'in-app (simulated)',
      simulated: true,
    };
    raised.push(rec);
    next.push(rec);
  }
  // keep history bounded: all active + last 600 resolved
  const active = next.filter((a) => a.status === 'active');
  const done = next.filter((a) => a.status === 'resolved').slice(-600);
  return { alerts: [...done, ...active], raised, resolved, escalated };
}

function currentValue(a: AlertRecord, s: SimState) {
  if (a.nodeId && a.param && s.nodes[a.nodeId]) return s.nodes[a.nodeId].current[a.param as Param] ?? a.value;
  return a.value;
}
