// Illustrative demand forecasting model (NOT a validated production model).
// Per village, an ordinary-least-squares regression is fitted on the 30-day synthetic history:
//   per-capita demand ~ β0 + β1·(T − 30) + β2·rain + β3·sunday
// The fit is then projected with population growth, monthly seasonality, user-set temperature,
// rainfall, per-capita norm and supply capacity. A 20/10-day backtest gives an honest MAPE.

import { CLIMATE } from './geo';
import { DAY } from './generator';
import { round } from './rng';
import type { DailySupply, ForecastSettings, SimState } from './types';

export interface ForecastPoint {
  day: string;
  demand: number;
  lo: number;
  hi: number;
  capacity: number;
  deficit: number;
}
export interface VillageForecast {
  next7: ForecastPoint[];
  daily30: { demand: number; band: number }[];
  avg7Demand: number;
  avg7Capacity: number;
  deficit7Pct: number;
  total30Demand: number;
  total30Capacity: number;
  deficit30KL: number;
  monthly: { month: string; demand: number; capacity: number }[];
  mape: number;
  coef: number[];
  shortage: boolean;
}

interface Fit {
  beta: number[];
  sigma: number;
  mape: number;
}
const fitCache = new WeakMap<DailySupply[], Map<number, Fit>>();

function features(T: number, rain: number, sunday: boolean) {
  return [1, T - 30, Math.min(rain, 30), sunday ? 1 : 0];
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-9;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-9));
}

function ols(X: number[][], y: number[], lambda = 0.5): number[] {
  const k = X[0].length;
  const A = Array.from({ length: k }, () => Array(k).fill(0));
  const b = Array(k).fill(0);
  X.forEach((x, i) => {
    for (let a = 0; a < k; a++) {
      b[a] += x[a] * y[i];
      for (let c = 0; c < k; c++) A[a][c] += x[a] * x[c];
    }
  });
  for (let a = 1; a < k; a++) A[a][a] += lambda; // ridge, intercept unpenalised
  return solve(A, b);
}

function fitVillage(hist: DailySupply[], pop: number, inst: number): Fit {
  let byPop = fitCache.get(hist);
  if (!byPop) {
    byPop = new Map();
    fitCache.set(hist, byPop);
  }
  const key = Math.round(pop) * 1000 + Math.round(inst);
  const hit = byPop.get(key);
  if (hit) return hit;
  const rows = hist.map((d) => ({ x: features(d.tempC, d.rainMM, new Date(d.day).getDay() === 0), y: ((d.demandKL - inst) * 1000) / Math.max(1, pop) }));
  const beta = ols(rows.map((r) => r.x), rows.map((r) => r.y));
  const resid = rows.map((r) => r.y - r.x.reduce((a, v, i) => a + v * beta[i], 0));
  const sigma = Math.sqrt(resid.reduce((a, e) => a + e * e, 0) / Math.max(1, resid.length - 4));
  // Backtest: train on first 20 days, test on last 10.
  const train = rows.slice(0, 20);
  const test = rows.slice(20);
  const bt = ols(train.map((r) => r.x), train.map((r) => r.y));
  const mape = (test.reduce((a, r) => a + Math.abs(r.y - r.x.reduce((s, v, i) => s + v * bt[i], 0)) / Math.max(1, r.y), 0) / Math.max(1, test.length)) * 100;
  const fit = { beta, sigma, mape: round(mape, 2) };
  byPop.set(key, fit);
  return fit;
}

export function villageForecast(state: SimState, vid: string, fc: ForecastSettings, currentSupplyKL: number): VillageForecast {
  const v = state.villages[vid];
  const hist = state.supplyHistory[vid];
  const fit = fitVillage(hist, v.basePopulation, v.institutionalKL);
  const now = new Date(state.simTime);
  const m0 = now.getMonth();
  const tempDelta = fc.temperatureC - CLIMATE[m0][0];
  const capacity = currentSupplyKL * (fc.supplyCapacityPct / 100);
  const popBase = v.population * (1 + fc.populationChangePct / 100);
  const perCapScale = fc.lpcd / 100;

  const predict = (k: number, T: number, rain: number) => {
    const d = new Date(state.simTime + k * DAY);
    const m = d.getMonth();
    const seasonal = CLIMATE[m][2] / CLIMATE[m0][2];
    const pc = features(T, rain, d.getDay() === 0).reduce((a, x, i) => a + x * fit.beta[i], 0) * seasonal * perCapScale;
    const pop = popBase * (1 + v.growthRate) ** (k / 365);
    return { d, demand: (pop * pc) / 1000 + v.institutionalKL, band: (1.96 * fit.sigma * pop * perCapScale) / 1000 };
  };

  const next7: ForecastPoint[] = [];
  let total30 = 0;
  const daily30: { demand: number; band: number }[] = [];
  for (let k = 1; k <= 30; k++) {
    const p = predict(k, fc.temperatureC, fc.rainfallMM);
    total30 += p.demand;
    daily30.push({ demand: p.demand, band: p.band });
    if (k <= 7)
      next7.push({ day: p.d.toISOString().slice(5, 10), demand: round(p.demand, 1), lo: round(p.demand - p.band, 1), hi: round(p.demand + p.band, 1), capacity: round(capacity, 1), deficit: round(Math.max(0, p.demand - capacity), 1) });
  }
  const monthly: VillageForecast['monthly'] = [];
  for (let mi = 0; mi < 6; mi++) {
    const d = new Date(now.getFullYear(), m0 + mi, 15);
    const k = Math.max(1, Math.round((d.getTime() - state.simTime) / DAY));
    const [Tm, Rm] = CLIMATE[d.getMonth()];
    const days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const p = predict(k, Tm + tempDelta, mi === 0 ? fc.rainfallMM : Rm);
    monthly.push({ month: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }), demand: round(p.demand * days, 0), capacity: round(capacity * days, 0) });
  }
  const avg7Demand = next7.reduce((a, p) => a + p.demand, 0) / 7;
  const deficit7Pct = avg7Demand > 0 ? Math.max(0, ((avg7Demand - capacity) / avg7Demand) * 100) : 0;
  return {
    next7,
    daily30,
    avg7Demand: round(avg7Demand, 1),
    avg7Capacity: round(capacity, 1),
    deficit7Pct: round(deficit7Pct, 1),
    total30Demand: round(total30, 0),
    total30Capacity: round(capacity * 30, 0),
    deficit30KL: round(Math.max(0, total30 - capacity * 30), 0),
    monthly,
    mape: fit.mape,
    coef: fit.beta.map((b) => round(b, 3)),
    shortage: false,
  };
}

export function defaultForecastSettings(simTime: number): ForecastSettings {
  const [T, R] = CLIMATE[new Date(simTime).getMonth()];
  return { populationChangePct: 0, lpcd: 100, rainfallMM: R, temperatureC: T, supplyCapacityPct: 100, horizonDays: 30 };
}
