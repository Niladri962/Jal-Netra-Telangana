// Core domain types for the JalNetra simulation engine.
// All records produced by the generator are SYNTHETIC and flagged `simulated: true`.

export type Severity = 'normal' | 'warning' | 'critical';
export type Param = 'ph' | 'tds' | 'turbidity' | 'chlorine' | 'orp' | 'flow' | 'pressure';
export const EDITABLE_PARAMS: Param[] = ['tds', 'turbidity', 'chlorine', 'ph', 'flow', 'pressure'];
export const ALL_PARAMS: Param[] = ['ph', 'tds', 'turbidity', 'chlorine', 'orp', 'flow', 'pressure'];

export type Readings = Record<Param, number>;

export interface District {
  id: string;
  name: string;
  lat: number;
  lng: number;
  sourceId: string;
  mandals: string[];
  simulated: false; // district names / HQ positions are real (approximate HQ coordinates)
}

export interface WaterSource {
  id: string;
  name: string;
  river: string;
  lat: number;
  lng: number;
  verified: 'real-water-body'; // the reservoir exists; its role in this network is illustrative
}

export interface WTP {
  id: string;
  name: string;
  sourceId: string;
  lat: number;
  lng: number;
  capacityMLD: number;
  simulated: true;
}

export interface ServiceReservoir {
  id: string; // district-level Master Balancing / Overhead Service Reservoir (illustrative)
  districtId: string;
  wtpId: string;
  lat: number;
  lng: number;
  simulated: true;
}

export type NodeKind = 'inlet' | 'ohsr' | 'tap';

export interface SensorNode {
  id: string;
  villageId: string;
  kind: NodeKind;
  label: string;
  lat: number;
  lng: number;
  baseline: Readings;
  current: Readings;
  prev: Readings;
  overrides: Partial<Record<Param, boolean>>;
  fault: boolean; // simulated sensor fault (measurement uncertainty)
  comms: 'LoRaWAN' | 'GSM' | 'NB-IoT';
  firmware: string;
  simulated: true;
}

export interface Village {
  id: string;
  name: string;
  mandal: string;
  districtId: string;
  lat: number;
  lng: number;
  population: number;
  basePopulation: number;
  growthRate: number; // annual
  supplyHours: number; // hours of supply per day
  supplyDaysPerWeek: number;
  reliability: number; // share of days without interruption (last 30 days), 0..1
  institutionalKL: number; // schools, PHCs, anganwadis, small industry (kL/day)
  demo: boolean;
  nodeIds: string[];
  simulated: true;
}

export type SegmentKind = 'intake' | 'transmission' | 'distribution' | 'service';

export interface Segment {
  id: string;
  kind: SegmentKind;
  fromId: string;
  toId: string;
  districtId: string;
  villageId?: string;
  coords: [number, number][];
  authorisedPct: number; // accounted authorised consumption en route (% of upstream)
  lossFactor: number; // physical loss (0..1) — hidden "truth" the detector must infer
  baseLossFactor: number;
  lossKind: 'none' | 'leak' | 'tap'; // hidden truth used only by the physics, never by the detector
  baseUpstream: number; // L/min (distribution/service) or MLD (transmission/intake)
  upstreamOverride?: number; // user override of upstream flow (L/min) for distribution, MLD for transmission
  simulated: true;
}

export interface HealthWeek {
  villageId: string;
  week: number; // 0 = oldest of 13 weeks, 12 = current week
  weekStart: string;
  diarrhoea: number;
  typhoid: number;
  cholera: number;
  giSymptoms: number;
  population: number;
  waterRiskIndicator: number; // weekly mean quality risk 0..100
  simulated: true;
}

export interface DailySupply {
  day: string; // ISO date
  suppliedKL: number;
  demandKL: number;
  interrupted: boolean;
  avgRisk: number;
  tempC: number;
  rainMM: number;
}

export interface Thresholds {
  ph: { lowWarn: number; lowCrit: number; highWarn: number; highCrit: number };
  tds: { warn: number; crit: number };
  turbidity: { warn: number; crit: number };
  chlorine: { lowWarn: number; lowCrit: number; highWarn: number; highCrit: number };
  orp: { lowWarn: number; lowCrit: number };
  flowRatio: { warn: number; crit: number }; // fraction of baseline flow
  pressure: { lowWarn: number; lowCrit: number; highWarn: number; highCrit: number };
  lpcdNorm: number;
  lpcdWarnPct: number; // below this % of norm => warning
  lpcdCritPct: number; // below this % of norm => critical
  lossTolerancePct: number;
  lossUncertaintyPct: number; // band above tolerance treated as measurement uncertainty
  lossCritPct: number;
  healthWarn: number;
  healthCrit: number;
  forecastDeficitPct: number;
}

export interface ForecastSettings {
  populationChangePct: number;
  lpcd: number;
  rainfallMM: number; // expected daily rainfall
  temperatureC: number; // expected daily max temperature
  supplyCapacityPct: number; // % of current supply capacity
  horizonDays: number;
}

export type AlertCategory =
  | 'Water quality'
  | 'Chemical safety'
  | 'Water supply'
  | 'Infrastructure'
  | 'Water loss'
  | 'Public health'
  | 'Demand forecasting';

export interface Condition {
  key: string;
  category: AlertCategory;
  severity: Exclude<Severity, 'normal'>;
  title: string;
  villageId?: string;
  districtId: string;
  nodeId?: string;
  segmentId?: string;
  param?: Param | 'lpcd' | 'loss' | 'health' | 'forecast';
  value: number;
  unit: string;
  explanation: string;
  actions: string[];
}

export interface AlertRecord extends Condition {
  id: string;
  status: 'active' | 'resolved';
  prevValue: number | null;
  createdSim: number;
  createdWall: number;
  updatedSim: number;
  resolvedSim?: number;
  resolvedWall?: number;
  history: { sim: number; wall: number; severity: Severity | 'resolved'; value: number; note: string }[];
  acknowledged: boolean;
  delivery: 'in-app (simulated)';
  simulated: true;
}

export interface ChangeEvent {
  id: string;
  sim: number;
  wall: number;
  nodeId?: string;
  villageId?: string;
  param: string;
  oldValue: number;
  newValue: number;
  source: 'user' | 'scenario' | 'event' | 'lab' | 'import' | 'ingest';
}

export interface LiveSample {
  t: number; // sim epoch ms
  v: Readings;
}

export interface SimEvent {
  id: string;
  type: EventType;
  targetId: string;
  label: string;
  sim: number;
  active: boolean;
  patches: { kind: 'node' | 'segment' | 'transmission'; id: string; field: string; original: number; value: number }[];
}

export interface SimState {
  seed: number;
  simTime: number; // epoch ms
  startTime: number;
  districts: District[];
  sources: WaterSource[];
  wtps: WTP[];
  reservoirs: ServiceReservoir[];
  villages: Record<string, Village>;
  villageOrder: string[];
  nodes: Record<string, SensorNode>;
  segments: Segment[];
  health: Record<string, HealthWeek[]>; // villageId -> 13 weeks
  supplyHistory: Record<string, DailySupply[]>; // villageId -> 30 days
  transmissionLoss: Record<string, number>; // districtId -> physical loss fraction on transmission main
  liveBuffer: Record<string, LiveSample[]>; // nodeId -> recent samples since sim start
  todayCases: Record<string, number>; // villageId -> extra suspected cases accrued this sim week
  events: SimEvent[];
}

export type EventType =
  | 'chlorinator-failure'
  | 'turbidity-spike'
  | 'tds-intrusion'
  | 'ph-excursion'
  | 'pipeline-leak'
  | 'illegal-tapping'
  | 'main-burst'
  | 'pump-failure'
  | 'sensor-fault';
