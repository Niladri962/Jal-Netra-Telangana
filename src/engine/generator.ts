// Synthetic data generation engine. Produces a fully linked demonstration environment:
// sources → WTPs → district service reservoirs → villages → sensor nodes, plus pipeline segments,
// 30-day supply history and 13-week (91-day) health surveillance history.
// All generated records are SIMULATED. Relationships (not independent randomness) are built in:
// population ↔ demand, flow ↔ LPCD, chlorine ↔ ORP, quality risk ↔ case incidence, interruptions ↔ reliability.

import { CLIMATE, DISTRICTS, NAME_STEMS, NAME_SUFFIXES, SOURCES } from './geo';
import { clamp, gauss, mulberry32, pick, poisson, rand, randInt, round, type RNG } from './rng';
import { orpFrom } from './thresholds';
import type {
  DailySupply,
  District,
  HealthWeek,
  Readings,
  Segment,
  SensorNode,
  ServiceReservoir,
  SimState,
  Village,
  WTP,
} from './types';

export const DAY = 86_400_000;
export const STEP_MIN = 15;

export interface GenPlan {
  featuredVillageId: string;
  chronic: { chlorine: string[]; turbidity: string[]; tds: string[]; leakSeg: string[]; tapSeg: string[]; fault: string[] };
}

function uniqueName(r: RNG, used: Set<string>) {
  for (let i = 0; i < 200; i++) {
    const n = pick(r, NAME_STEMS) + pick(r, NAME_SUFFIXES);
    if (!used.has(n)) {
      used.add(n);
      return n;
    }
  }
  const n = `Habitation-${used.size + 1}`;
  used.add(n);
  return n;
}

function startOfSimClock(): number {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(6);
  return d.getTime();
}

export function generateDataset(seed: number): { state: SimState; plan: GenPlan } {
  const r = mulberry32(seed);
  const simTime = startOfSimClock();
  const usedNames = new Set<string>();

  const districts: District[] = DISTRICTS.map((d) => ({ ...d, simulated: false as const }));

  // --- Treatment plants (illustrative, near each real source)
  const wtps: WTP[] = SOURCES.map((s, i) => ({
    id: `wtp-${s.id.slice(4)}`,
    name: `${s.name.split(' ')[0]} WTP (sim)`,
    sourceId: s.id,
    lat: s.lat + (i % 2 ? 0.06 : -0.05),
    lng: s.lng + (i % 3 ? 0.07 : -0.06),
    capacityMLD: 0,
    simulated: true as const,
  }));
  const wtpBySource = Object.fromEntries(wtps.map((w) => [w.sourceId, w]));

  // --- District service reservoirs (illustrative)
  const reservoirs: ServiceReservoir[] = districts.map((d) => ({
    id: `mbr-${d.id}`,
    districtId: d.id,
    wtpId: wtpBySource[d.sourceId].id,
    lat: d.lat + 0.035,
    lng: d.lng - 0.04,
    simulated: true as const,
  }));

  const villages: Record<string, Village> = {};
  const villageOrder: string[] = [];
  const nodes: Record<string, SensorNode> = {};
  const segments: Segment[] = [];
  const transmissionLoss: Record<string, number> = {};
  let demoCount = 0;
  let featuredVillageId = '';

  // District-level water chemistry character (illustrative)
  const districtTds: Record<string, number> = {};
  for (const d of districts) districtTds[d.id] = rand(r, 180, 430);

  for (const d of districts) {
    const mbr = reservoirs.find((m) => m.districtId === d.id)!;
    const count = d.id === 'hyd' ? 2 : d.mandals.length;
    for (let i = 0; i < count; i++) {
      const vid = `${d.id}-v${i + 1}`;
      const ang = (2 * Math.PI * i) / count + rand(r, -0.35, 0.35) + (d.lat * 7) % 1;
      const rad = d.id === 'hyd' ? rand(r, 0.04, 0.07) : rand(r, 0.1, 0.24);
      const lat = round(d.lat + rad * Math.sin(ang), 4);
      const lng = round(d.lng + rad * 1.1 * Math.cos(ang), 4);
      const name = uniqueName(r, usedNames);
      const population = Math.round(clamp(Math.exp(rand(r, Math.log(1600), Math.log(12500))), 1200, 14000) / 10) * 10;

      // Target LPCD distribution: mostly adequate, some moderate, few severe shortages
      const u = r();
      let targetLpcd = u < 0.8 ? rand(r, 86, 118) : u < 0.93 ? rand(r, 52, 74) : rand(r, 24, 38);
      const isDemo = demoCount < 14 && (i === 0 || (d.id === 'nlg' && i === 1));
      const isFeatured = d.id === 'nlg' && i === 0;
      if (isFeatured) targetLpcd = 104;
      if (isDemo) demoCount++;

      const supplyHours = targetLpcd < 45 ? randInt(r, 4, 8) : targetLpcd < 75 ? randInt(r, 8, 14) : randInt(r, 16, 24);
      const reliability = targetLpcd < 45 ? rand(r, 0.62, 0.8) : targetLpcd < 75 ? rand(r, 0.78, 0.9) : rand(r, 0.9, 0.995);
      const inletFlow = round((population * targetLpcd) / (supplyHours * 60), 1);

      const village: Village = {
        id: vid,
        name,
        mandal: d.mandals[i % d.mandals.length],
        districtId: d.id,
        lat,
        lng,
        population,
        basePopulation: population,
        growthRate: round(rand(r, 0.006, 0.018), 4),
        supplyHours,
        supplyDaysPerWeek: targetLpcd < 45 ? randInt(r, 4, 6) : 7,
        reliability: round(reliability, 3),
        institutionalKL: round(population * rand(r, 0.002, 0.006), 1),
        demo: isDemo,
        nodeIds: [],
        simulated: true,
      };
      if (isFeatured) featuredVillageId = vid;

      const tds0 = districtTds[d.id] + rand(r, -40, 60);
      const mk = (kind: 'inlet' | 'ohsr' | 'tap', idx: number): SensorNode => {
        const off = kind === 'inlet' ? [0, 0] : kind === 'ohsr' ? [0.012, 0.014] : [-0.014, 0.018 + idx * 0.004];
        const chlorine = kind === 'inlet' ? rand(r, 0.68, 0.86) : kind === 'ohsr' ? rand(r, 0.55, 0.75) : rand(r, 0.34, 0.6);
        const ph = rand(r, 7.15, 7.8);
        const turbidity = kind === 'inlet' ? rand(r, 0.25, 0.55) : rand(r, 0.35, 0.8);
        const flow = kind === 'tap' ? rand(r, 45, 120) : kind === 'ohsr' ? inletFlow * rand(r, 0.92, 0.98) : inletFlow;
        const pressure = kind === 'inlet' ? rand(r, 1.6, 2.8) : kind === 'ohsr' ? rand(r, 1.1, 1.8) : rand(r, 0.95, 1.5);
        const base: Readings = {
          ph: round(ph, 2),
          tds: Math.round(tds0 + rand(r, -15, 15)),
          turbidity: round(turbidity, 2),
          chlorine: round(chlorine, 2),
          orp: 0,
          flow: round(flow, 1),
          pressure: round(pressure, 2),
        };
        if (isFeatured && kind === 'tap') {
          base.chlorine = 0.5;
          base.tds = 300;
          base.turbidity = 0.6;
          base.ph = 7.4;
          base.flow = 100;
          base.pressure = 1.2;
        }
        base.orp = Math.round(orpFrom(base.chlorine, base.ph, base.turbidity));
        const id = `${vid}-${kind === 'tap' ? 'tap' + (idx + 1) : kind}`;
        return {
          id,
          villageId: vid,
          kind,
          label: kind === 'inlet' ? 'Village storage tank inlet' : kind === 'ohsr' ? 'OHSR outlet' : 'End-point tap / stand-post',
          lat: round(lat + off[0], 4),
          lng: round(lng + off[1], 4),
          baseline: base,
          current: { ...base },
          prev: { ...base },
          overrides: {},
          fault: false,
          comms: pick(r, ['LoRaWAN', 'GSM', 'NB-IoT'] as const),
          firmware: `esp32-jn ${randInt(r, 1, 2)}.${randInt(r, 0, 9)}.${randInt(r, 0, 9)}`,
          simulated: true,
        };
      };

      const vn: SensorNode[] = [mk('inlet', 0)];
      if (isDemo) vn.push(mk('ohsr', 0));
      vn.push(mk('tap', 0));
      for (const n of vn) {
        nodes[n.id] = n;
        village.nodeIds.push(n.id);
      }
      villages[vid] = village;
      villageOrder.push(vid);

      // Distribution segment MBR → village inlet
      const auth = round(rand(r, 0.01, 0.03), 3);
      const baseLoss = round(rand(r, 0.015, 0.045), 3);
      segments.push({
        id: `seg-d-${vid}`,
        kind: 'distribution',
        fromId: mbr.id,
        toId: vn[0].id,
        districtId: d.id,
        villageId: vid,
        coords: [
          [mbr.lat, mbr.lng],
          [lat, lng],
        ],
        authorisedPct: round(auth * 100, 1),
        lossFactor: baseLoss,
        baseLossFactor: baseLoss,
        lossKind: 'none',
        baseUpstream: round(inletFlow / (1 - auth - baseLoss), 1),
        simulated: true,
      });
      // Service segments inside the village
      for (let k = 1; k < vn.length; k++) {
        const a = vn[k - 1];
        const b = vn[k];
        segments.push({
          id: `seg-s-${b.id}`,
          kind: 'service',
          fromId: a.id,
          toId: b.id,
          districtId: d.id,
          villageId: vid,
          coords: [
            [a.lat, a.lng],
            [b.lat, b.lng],
          ],
          authorisedPct: 0,
          lossFactor: 0,
          baseLossFactor: 0,
          lossKind: 'none',
          baseUpstream: a.baseline.flow,
          simulated: true,
        });
      }
    }

    // Transmission main WTP → district reservoir (MLD)
    const wtp = wtpBySource[d.sourceId];
    const dailyMLD = villageOrder
      .filter((v) => villages[v].districtId === d.id)
      .reduce((acc, v) => {
        const seg = segments.find((s) => s.id === `seg-d-${v}`)!;
        return acc + (seg.baseUpstream * villages[v].supplyHours * 60) / 1e6;
      }, 0);
    const tLoss = round(rand(r, 0.015, 0.035), 3);
    transmissionLoss[d.id] = tLoss;
    wtp.capacityMLD += dailyMLD * 1.25;
    segments.push({
      id: `seg-t-${d.id}`,
      kind: 'transmission',
      fromId: wtp.id,
      toId: mbr.id,
      districtId: d.id,
      coords: [
        [wtp.lat, wtp.lng],
        [mbr.lat, mbr.lng],
      ],
      authorisedPct: 0.5,
      lossFactor: tLoss,
      baseLossFactor: tLoss,
      lossKind: 'none',
      baseUpstream: round(dailyMLD / (1 - tLoss - 0.005), 4),
      simulated: true,
    });
  }

  // Raw-water intake segments (unmonitored in this simulation → grey)
  for (const w of wtps) {
    const s = SOURCES.find((x) => x.id === w.sourceId)!;
    w.capacityMLD = round(w.capacityMLD, 3);
    segments.push({
      id: `seg-i-${w.id}`,
      kind: 'intake',
      fromId: s.id,
      toId: w.id,
      districtId: districts.find((d) => d.sourceId === s.id)?.id ?? '',
      coords: [
        [s.lat, s.lng],
        [w.lat, w.lng],
      ],
      authorisedPct: 0,
      lossFactor: 0,
      baseLossFactor: 0,
      lossKind: 'none',
      baseUpstream: w.capacityMLD,
      simulated: true,
    });
  }

  // --- Choose chronic abnormal locations (never the featured demo village)
  const candidates = villageOrder.filter((v) => v !== featuredVillageId && villages[v].districtId !== 'hyd');
  const shuffled = [...candidates].sort(() => r() - 0.5);
  const plan: GenPlan = {
    featuredVillageId,
    chronic: {
      chlorine: shuffled.slice(0, 2),
      turbidity: shuffled.slice(2, 3),
      tds: shuffled.slice(3, 5),
      leakSeg: [`seg-d-${shuffled[5]}`],
      tapSeg: [`seg-d-${shuffled[6]}`],
      fault: [villages[shuffled[7]].nodeIds[villages[shuffled[7]].nodeIds.length - 1]],
    },
  };

  // --- 30-day supply history & 13-week health surveillance
  const supplyHistory: Record<string, DailySupply[]> = {};
  const health: Record<string, HealthWeek[]> = {};
  const elevated = new Set([...plan.chronic.chlorine, ...plan.chronic.turbidity]);
  for (const vid of villageOrder) {
    const v = villages[vid];
    const inlet = nodes[v.nodeIds[0]];
    const baseKL = (inlet.baseline.flow * v.supplyHours * 60) / 1000;
    const arr: DailySupply[] = [];
    for (let k = 30; k >= 1; k--) {
      const t = simTime - k * DAY;
      const dt = new Date(t);
      const [tm, rm, sm] = CLIMATE[dt.getMonth()];
      const tempC = round(tm + gauss(r) * 1.6, 1);
      const rainMM = round(r() < 0.25 ? -Math.log(1 - r()) * rm * 2.5 : 0, 1);
      const interrupted = r() > v.reliability;
      const supplied = baseKL * (interrupted ? rand(r, 0.2, 0.6) : rand(r, 0.94, 1.05));
      const demand =
        (v.population * 100) / 1000 * sm * (1 + 0.012 * (tempC - 30)) * (1 - 0.008 * Math.min(rainMM, 25)) * (dt.getDay() === 0 ? 1.03 : 1) +
        v.institutionalKL +
        gauss(r) * v.population * 0.002;
      const lateBad = elevated.has(vid) && k <= 6;
      arr.push({
        day: dt.toISOString().slice(0, 10),
        suppliedKL: round(supplied, 1),
        demandKL: round(demand, 1),
        interrupted,
        avgRisk: round(clamp((lateBad ? 52 : 4) + gauss(r) * 1.2 + (interrupted ? 3 : 0), 0, 100), 1),
        tempC,
        rainMM,
      });
    }
    supplyHistory[vid] = arr;

    const weeks: HealthWeek[] = [];
    const dRate = rand(r, 4, 10); // suspected diarrhoea per 10k per week
    for (let w = 0; w < 13; w++) {
      const weekStart = new Date(simTime - (12 - w) * 7 * DAY - new Date(simTime).getDay() * DAY);
      const seasonal = 1 + 0.35 * Math.max(0, (6 - w) / 6); // late-monsoon weeks higher
      const surge = elevated.has(vid) && w >= 9 ? 1 + (w - 8) * 0.45 : 1;
      const lam = (v.population / 10000) * dRate * seasonal * surge;
      const diarrhoea = poisson(r, lam);
      weeks.push({
        villageId: vid,
        week: w,
        weekStart: weekStart.toISOString().slice(0, 10),
        diarrhoea,
        typhoid: poisson(r, (v.population / 10000) * 0.6 * seasonal * (surge > 1 ? 1.5 : 1)),
        cholera: poisson(r, (v.population / 10000) * 0.015 * (surge > 1 ? 4 : 1)),
        giSymptoms: diarrhoea + poisson(r, lam * 0.9),
        population: v.population,
        waterRiskIndicator: round(clamp((surge > 1 ? 40 + w * 2 : 9) + gauss(r) * 3, 0, 100), 1),
        simulated: true,
      });
    }
    health[vid] = weeks;
  }

  const state: SimState = {
    seed,
    simTime,
    startTime: simTime,
    districts,
    sources: SOURCES,
    wtps,
    reservoirs,
    villages,
    villageOrder,
    nodes,
    segments,
    health,
    supplyHistory,
    transmissionLoss,
    liveBuffer: Object.fromEntries(Object.keys(nodes).map((id) => [id, [{ t: simTime, v: { ...nodes[id].current } }]])),
    todayCases: Object.fromEntries(villageOrder.map((v) => [v, 0])),
    events: [],
  };
  return { state, plan };
}
