// Global application store. Every mutation funnels through `commit`, which recomputes the derived
// intelligence layer and diffs alerts — this is what makes a single slider change propagate to the
// map, KPIs, charts, rankings, alerts, health indicators and the assistant at once.

import { create } from 'zustand';
import { buildConditions, diffAlerts } from './engine/alerts';
import { computeDerived, type Derived } from './engine/compute';
import { defaultForecastSettings } from './engine/forecast';
import { generateDataset, type GenPlan } from './engine/generator';
import { clearHistoryCache } from './engine/history';
import * as sim from './engine/sim';
import { DEFAULT_THRESHOLDS } from './engine/thresholds';
import type { AlertRecord, ChangeEvent, EventType, ForecastSettings, Param, SimState, Thresholds } from './engine/types';

export type Basemap = 'dark' | 'streets' | 'satellite' | 'none';
export type Page = 'command' | 'grid' | 'monitoring' | 'forecast' | 'pipeline' | 'health' | 'equity' | 'assistant' | 'lab' | 'reports' | 'alerts' | 'data';

export interface Toast {
  id: string;
  severity: 'warning' | 'critical' | 'info' | 'resolved';
  title: string;
  body: string;
  villageId?: string;
}

export interface Filters {
  district: string;
  mandal: string;
  village: string;
  days: number;
  severity: 'all' | 'warning' | 'critical';
}

export interface Layers {
  pipelines: boolean;
  quality: boolean;
  supply: boolean;
  health: boolean;
  equity: boolean;
  infrastructure: boolean;
  flowAnimation: boolean;
  nodes: boolean;
}

interface Store {
  sim: SimState;
  plan: GenPlan;
  derived: Derived;
  alerts: AlertRecord[];
  changes: ChangeEvent[];
  thresholds: Thresholds;
  forecast: ForecastSettings;
  running: boolean;
  speed: number; // ticks per 3 seconds
  page: Page;
  selectedVillageId?: string;
  selectedNodeId?: string;
  selectedDistrictId?: string;
  selectedSegmentId?: string;
  filters: Filters;
  layers: Layers;
  mapLayer: 'quality' | 'supply' | 'health' | 'equity';
  basemap: Basemap;
  setBasemap: (b: Basemap) => void;
  toasts: Toast[];
  browserNotify: boolean;
  backend: { online: boolean; llm: boolean; model?: string; ingest: boolean };
  ingestConnected: boolean;
  assistantPrompt?: string;
  setAssistantPrompt: (q?: string) => void;
  askAssistant: (q: string) => void;

  setPage: (p: Page) => void;
  selectVillage: (vid?: string, nodeId?: string) => void;
  selectDistrict: (id?: string) => void;
  selectSegment: (id?: string) => void;
  setFilters: (f: Partial<Filters>) => void;
  setLayers: (l: Partial<Layers>) => void;
  setMapLayer: (l: Store['mapLayer']) => void;
  tick: () => void;
  setRunning: (r: boolean) => void;
  setSpeed: (s: number) => void;
  setParam: (nodeId: string, p: Param, value: number, source?: ChangeEvent['source']) => void;
  restoreNode: (nodeId: string, params?: Param[]) => void;
  restoreVillage: (vid: string) => void;
  setPopulation: (vid: string, pop: number) => void;
  setSupplyMLD: (vid: string, mld: number) => void;
  setSegmentUpstream: (segId: string, value?: number) => void;
  setSegmentAuth: (segId: string, pct: number) => void;
  addEvent: (type: EventType, targetId: string) => void;
  resolveEvent: (id: string) => void;
  newDataset: (seed?: number) => void;
  resetSimulation: () => void;
  setThresholds: (t: Partial<Thresholds>) => void;
  setForecast: (f: Partial<ForecastSettings>) => void;
  ackAlert: (id: string) => void;
  dismissToast: (id: string) => void;
  pushToast: (t: Omit<Toast, 'id'>) => void;
  setBrowserNotify: (b: boolean) => void;
  setBackend: (b: Partial<Store['backend']>) => void;
  setIngestConnected: (b: boolean) => void;
  importReadings: (rows: { nodeId: string; param: Param; value: number }[]) => number;
  importVillages: (rows: { villageId: string; population?: number; supplyMLD?: number }[]) => number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function boot(seed: number) {
  const { state, plan } = generateDataset(seed);
  sim.reseedTickRng(seed);
  clearHistoryCache();
  const seeded = sim.seedEvents(state, plan);
  return { state: seeded, plan };
}

function derive(state: SimState, th: Thresholds, fc: ForecastSettings, prevAlerts: AlertRecord[], changes: ChangeEvent[]) {
  const derived = computeDerived(state, th, fc);
  const conds = buildConditions(state, derived, th);
  const diff = diffAlerts(prevAlerts, conds, state, changes);
  for (const d of Object.values(derived.districts)) d.criticalAlerts = diff.alerts.filter((a) => a.status === 'active' && a.severity === 'critical' && a.districtId === d.id).length;
  return { derived, ...diff };
}

const initialSeed = 20261119;
const init = boot(initialSeed);
const initFc = defaultForecastSettings(init.state.simTime);
const initD = derive(init.state, DEFAULT_THRESHOLDS, initFc, [], []);

export const useStore = create<Store>((set, get) => {
  /** Apply a new SimState (and optional change records), recompute everything, surface notifications. */
  const commit = (state: SimState, newChanges: ChangeEvent[] = [], patch: Partial<Store> = {}) => {
    const s = get();
    const th = patch.thresholds ?? s.thresholds;
    const fc = patch.forecast ?? s.forecast;
    const changes = [...s.changes, ...newChanges].slice(-500);
    const r = derive(state, th, fc, s.alerts, changes);
    const toasts = [...s.toasts];
    const userDriven = newChanges.length > 0;
    for (const a of [...r.raised, ...r.escalated].slice(0, 4)) {
      if (a.severity === 'critical' || userDriven) {
        toasts.push({ id: uid(), severity: a.severity, title: a.title, body: a.explanation.slice(0, 180) + '…', villageId: a.villageId });
        notifyBrowser(s.browserNotify, a);
      }
    }
    if (userDriven) for (const a of r.resolved.slice(0, 3)) toasts.push({ id: uid(), severity: 'resolved', title: `Resolved: ${a.title}`, body: 'Condition no longer present — alert auto-resolved.', villageId: a.villageId });
    set({ sim: state, derived: r.derived, alerts: r.alerts, changes, toasts: toasts.slice(-5), ...patch });
  };

  return {
    sim: init.state,
    plan: init.plan,
    derived: initD.derived,
    alerts: initD.alerts,
    changes: [],
    thresholds: DEFAULT_THRESHOLDS,
    forecast: initFc,
    running: true,
    speed: 1,
    page: 'command',
    selectedVillageId: undefined,
    filters: { district: '', mandal: '', village: '', days: 30, severity: 'all' },
    layers: { pipelines: true, quality: true, supply: false, health: false, equity: false, infrastructure: true, flowAnimation: true, nodes: true },
    mapLayer: 'quality',
    basemap: 'dark',
    setBasemap: (basemap) => set({ basemap }),
    toasts: [],
    browserNotify: false,
    backend: { online: false, llm: false, ingest: false },
    ingestConnected: false,
    assistantPrompt: undefined,
    setAssistantPrompt: (assistantPrompt) => set({ assistantPrompt }),
    askAssistant: (q) => { set({ assistantPrompt: q }); get().setPage('assistant'); },

    setPage: (page) => {
      set({ page });
      try {
        window.location.hash = page;
      } catch {
        /* ignore */
      }
    },
    selectVillage: (vid, nodeId) => set({ selectedVillageId: vid, selectedNodeId: nodeId ?? (vid ? get().sim.villages[vid].nodeIds[get().sim.villages[vid].nodeIds.length - 1] : undefined) }),
    selectDistrict: (id) => set({ selectedDistrictId: id }),
    selectSegment: (id) => set({ selectedSegmentId: id }),
    setFilters: (f) => set({ filters: { ...get().filters, ...f } }),
    setLayers: (l) => set({ layers: { ...get().layers, ...l } }),
    setMapLayer: (mapLayer) => set({ mapLayer }),

    tick: () => {
      const s = get();
      let st = s.sim;
      for (let i = 0; i < s.speed; i++) st = sim.tick(st, s.thresholds);
      commit(st);
    },
    setRunning: (running) => set({ running }),
    setSpeed: (speed) => set({ speed }),

    setParam: (nodeId, p, value, source = 'user') => {
      const r = sim.setNodeParam(get().sim, nodeId, p, value);
      commit(r.state, [{ ...r.change, source }]);
    },
    restoreNode: (nodeId, params) => {
      const r = sim.restoreNode(get().sim, nodeId, params);
      commit(r.state, r.changes);
    },
    restoreVillage: (vid) => {
      let st = get().sim;
      const all: ChangeEvent[] = [];
      for (const nid of st.villages[vid].nodeIds) {
        const r = sim.restoreNode(st, nid);
        st = r.state;
        all.push(...r.changes);
      }
      const v = st.villages[vid];
      st = sim.setVillagePopulation(st, vid, v.basePopulation);
      commit(st, all.length ? all : [{ id: uid(), sim: st.simTime, wall: Date.now(), villageId: vid, param: 'restore', oldValue: 0, newValue: 0, source: 'user' }]);
    },
    setPopulation: (vid, pop) => {
      const old = get().sim.villages[vid].population;
      commit(sim.setVillagePopulation(get().sim, vid, pop), [{ id: uid(), sim: get().sim.simTime, wall: Date.now(), villageId: vid, param: 'population', oldValue: old, newValue: pop, source: 'user' }]);
    },
    setSupplyMLD: (vid, mld) => {
      const st = get().sim;
      const v = st.villages[vid];
      const flow = (mld * 1e6) / (v.supplyHours * 60) / (v.supplyDaysPerWeek / 7);
      const r = sim.setNodeParam(st, v.nodeIds[0], 'flow', Math.round(flow * 10) / 10);
      commit(r.state, [r.change]);
    },
    setSegmentUpstream: (segId, value) => {
      let st = sim.setSegment(get().sim, segId, { upstreamOverride: value });
      const seg = st.segments.find((s) => s.id === segId)!;
      if (seg.villageId) st = sim.settleVillage(st, seg.villageId);
      commit(st, [{ id: uid(), sim: st.simTime, wall: Date.now(), villageId: seg.villageId, param: 'upstream', oldValue: seg.baseUpstream, newValue: value ?? seg.baseUpstream, source: 'user' }]);
    },
    setSegmentAuth: (segId, pct) => {
      const st = sim.setSegment(get().sim, segId, { authorisedPct: pct });
      commit(st, [{ id: uid(), sim: st.simTime, wall: Date.now(), param: 'authorised', oldValue: 0, newValue: pct, source: 'user' }]);
    },
    addEvent: (type, targetId) => {
      const st = sim.applyEvent(get().sim, type, targetId);
      commit(st, [{ id: uid(), sim: st.simTime, wall: Date.now(), villageId: st.villages[targetId] ? targetId : undefined, param: `event:${type}`, oldValue: 0, newValue: 1, source: 'event' }]);
    },
    resolveEvent: (id) => {
      const st = sim.resolveEvent(get().sim, id);
      commit(st, [{ id: uid(), sim: st.simTime, wall: Date.now(), param: 'event:resolved', oldValue: 1, newValue: 0, source: 'event' }]);
    },
    newDataset: (seed) => {
      const b = boot(seed ?? Math.floor(Math.random() * 1e9));
      const fc = defaultForecastSettings(b.state.simTime);
      const r = derive(b.state, get().thresholds, fc, [], []);
      set({ sim: b.state, plan: b.plan, derived: r.derived, alerts: r.alerts, changes: [], forecast: fc, selectedVillageId: undefined, selectedNodeId: undefined, toasts: [] });
    },
    resetSimulation: () => get().newDataset(get().sim.seed),
    setThresholds: (t) => commit(get().sim, [], { thresholds: { ...get().thresholds, ...t } }),
    setForecast: (f) => commit(get().sim, [], { forecast: { ...get().forecast, ...f } }),
    ackAlert: (id) => set({ alerts: get().alerts.map((a) => (a.id === id ? { ...a, acknowledged: true } : a)) }),
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    pushToast: (t) => set({ toasts: [...get().toasts, { ...t, id: uid() }].slice(-5) }),
    setBrowserNotify: (browserNotify) => set({ browserNotify }),
    setBackend: (b) => set({ backend: { ...get().backend, ...b } }),
    setIngestConnected: (ingestConnected) => set({ ingestConnected }),
    importReadings: (rows) => {
      let st = get().sim;
      const ch: ChangeEvent[] = [];
      let n = 0;
      for (const row of rows) {
        if (!st.nodes[row.nodeId] || !Number.isFinite(row.value)) continue;
        const r = sim.setNodeParam(st, row.nodeId, row.param, row.value);
        st = r.state;
        ch.push({ ...r.change, source: 'import' });
        n++;
      }
      if (n) commit(st, ch);
      return n;
    },
    importVillages: (rows) => {
      let st = get().sim;
      const ch: ChangeEvent[] = [];
      let n = 0;
      for (const row of rows) {
        const v = st.villages[row.villageId];
        if (!v) continue;
        if (row.population && row.population > 0) st = sim.setVillagePopulation(st, row.villageId, row.population);
        if (row.supplyMLD && row.supplyMLD >= 0) {
          const flow = (row.supplyMLD * 1e6) / (v.supplyHours * 60) / (v.supplyDaysPerWeek / 7);
          const r = sim.setNodeParam(st, v.nodeIds[0], 'flow', Math.round(flow * 10) / 10);
          st = r.state;
          ch.push({ ...r.change, source: 'import' });
        }
        n++;
      }
      if (n) commit(st, ch.length ? ch : [{ id: uid(), sim: st.simTime, wall: Date.now(), param: 'import', oldValue: 0, newValue: n, source: 'import' }]);
      return n;
    },
  };
});

function notifyBrowser(enabled: boolean, a: AlertRecord) {
  if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    new Notification(`[SIMULATED] ${a.title}`, { body: `${a.value} ${a.unit} — JalNetra in-app simulation. No SMS/WhatsApp sent.`, tag: a.key });
  } catch {
    /* ignore */
  }
}

// Selectors / helpers
export const villagesInFilter = (s: { sim: SimState; filters: Filters }) =>
  s.sim.villageOrder.filter((vid) => {
    const v = s.sim.villages[vid];
    if (s.filters.district && v.districtId !== s.filters.district) return false;
    if (s.filters.mandal && v.mandal !== s.filters.mandal) return false;
    if (s.filters.village && vid !== s.filters.village) return false;
    return true;
  });
