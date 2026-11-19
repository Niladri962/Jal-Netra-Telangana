// 30 days of 15-minute synthetic sensor history per node, generated deterministically on demand
// (2,880 samples × 7 parameters per node). Generated lazily to keep start-up fast; the same node
// always yields the same history for a given dataset seed. Live samples recorded since the
// simulation started are appended by the charts from SimState.liveBuffer.

import { DAY } from './generator';
import { gauss, hashString, mulberry32, round } from './rng';
import { orpFrom } from './thresholds';
import type { LiveSample, Readings, SensorNode, SimEvent } from './types';

const cache = new Map<string, LiveSample[]>();
export function clearHistoryCache() {
  cache.clear();
}

export function nodeHistory(node: SensorNode, startTime: number, seed: number, events: SimEvent[]): LiveSample[] {
  const key = `${seed}:${node.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = mulberry32(hashString(key));
  const N = 30 * 96;
  const out: LiveSample[] = [];
  // Use the *reference* baseline (before seeded events) for history, then blend in seeded
  // events for the last 2 days so history leads up to the present condition.
  const ref: Readings = { ...node.baseline };
  const onset: Partial<Record<keyof Readings, { t: number; value: number }>> = {};
  for (const e of events)
    for (const p of e.patches)
      if (p.kind === 'node' && p.id === node.id && p.field !== 'fault') {
        (ref as any)[p.field] = p.original;
        onset[p.field as keyof Readings] = { t: e.sim, value: p.value };
      }
  const cur = { ...ref };
  let faultUntil = -1;
  for (let i = 0; i < N; i++) {
    const t = startTime - (N - i) * 15 * 60_000;
    const h = new Date(t).getHours() + new Date(t).getMinutes() / 60;
    const day = Math.floor((startTime - t) / DAY);
    if (faultUntil < i && r() < 0.0008) faultUntil = i + 8 + Math.floor(r() * 20); // occasional sensor glitch
    const interruption = r() < 0.004;
    for (const p of ['ph', 'tds', 'turbidity', 'chlorine', 'flow', 'pressure'] as const) {
      let target = ref[p];
      const o = onset[p];
      if (o && t >= o.t) target = ref[p] + (o.value - ref[p]) * Math.min(1, (t - o.t) / (6 * 3600_000));
      if (p === 'flow') target *= (1 + 0.05 * Math.sin((2 * Math.PI * (h - 8)) / 12)) * (interruption ? 0.3 : 1);
      if (p === 'chlorine') target *= 1 - 0.04 * Math.sin((2 * Math.PI * (h - 14)) / 24);
      if (p === 'turbidity' && day % 9 === 4 && h > 14 && h < 20) target *= 1.6; // post-rain bump
      const noise = { ph: 0.03, tds: 4, turbidity: 0.03, chlorine: 0.012, flow: 0.012 * ref.flow, pressure: 0.015 * ref.pressure }[p];
      cur[p] = Math.max(0, cur[p] + 0.4 * (target - cur[p]) + gauss(r) * noise);
    }
    const v: Readings = {
      ph: round(cur.ph, 2),
      tds: Math.round(cur.tds),
      turbidity: round(faultUntil >= i ? cur.turbidity * (1 + Math.abs(gauss(r)) * 3) : cur.turbidity, 2),
      chlorine: round(cur.chlorine, 3),
      orp: Math.round(orpFrom(cur.chlorine, cur.ph, cur.turbidity) + gauss(r) * 6),
      flow: round(faultUntil >= i ? cur.flow * (0.5 + r()) : cur.flow, 1),
      pressure: round(cur.pressure, 2),
    };
    out.push({ t, v });
  }
  cache.set(key, out);
  return out;
}

/** History + live samples, downsampled to `points` for charting. */
export function seriesFor(node: SensorNode, startTime: number, seed: number, events: SimEvent[], live: LiveSample[], hours: number, points = 160) {
  const hist = nodeHistory(node, startTime, seed, events);
  const end = live.length ? live[live.length - 1].t : startTime;
  const from = end - hours * 3600_000;
  const all = [...hist.filter((s) => s.t >= from), ...live.filter((s) => s.t >= from)];
  const step = Math.max(1, Math.floor(all.length / points));
  const out: (Readings & { t: number; live: boolean })[] = [];
  for (let i = 0; i < all.length; i += step) out.push({ ...all[i].v, t: all[i].t, live: all[i].t >= startTime });
  if (all.length && out[out.length - 1].t !== all[all.length - 1].t) {
    const l = all[all.length - 1];
    out.push({ ...l.v, t: l.t, live: l.t >= startTime });
  }
  return out;
}
