import { useEffect, useRef, useState } from 'react';
import { Database, Download, Pause, Play, Plug, RefreshCw, RotateCcw, Sliders, Upload, Zap } from 'lucide-react';
import { Card, fmtTime, Notice, PageHeader, SevBadge, Stat } from '../components/ui';
import { nodeHistory } from '../engine/history';
import { EVENT_LABELS } from '../engine/sim';
import { DEFAULT_THRESHOLDS } from '../engine/thresholds';
import type { EventType, Param, Thresholds } from '../engine/types';
import { connectTelemetry } from '../lib/backend';
import { downloadCSV, parseCSV } from '../lib/export';
import { useStore } from '../store';

export default function DataPage() {
  const s = useStore();
  const { sim, derived } = s;
  const [seed, setSeed] = useState(String(sim.seed));
  const [evType, setEvType] = useState<EventType>('chlorinator-failure');
  const [evTarget, setEvTarget] = useState(sim.villageOrder[3]);
  const [msg, setMsg] = useState('');
  const [histNode, setHistNode] = useState(sim.villages[s.plan.featuredVillageId].nodeIds[0]);
  const [packets, setPackets] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const disconnectRef = useRef<() => void>();

  const targetKind = EVENT_LABELS[evType].target;
  useEffect(() => {
    setEvTarget(targetKind === 'district' ? sim.districts[0].id : targetKind === 'node' ? Object.keys(sim.nodes)[0] : sim.villageOrder[3]);
  }, [targetKind]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => disconnectRef.current?.(), []);

  const exportAll = (kind: string) => {
    if (kind === 'villages')
      downloadCSV('jalnetra_villages_SIMULATED.csv', sim.villageOrder.map((v) => ({ village_id: v, name: sim.villages[v].name, mandal: sim.villages[v].mandal, district: sim.districts.find((d) => d.id === sim.villages[v].districtId)?.name, lat: sim.villages[v].lat, lng: sim.villages[v].lng, population: sim.villages[v].population, growth_rate: sim.villages[v].growthRate, supply_hours: sim.villages[v].supplyHours, supply_mld: derived.villages[v].supplyKL / 1000, lpcd: derived.villages[v].lpcd, equity: derived.villages[v].equityScore, status: derived.villages[v].status, simulated: true })));
    if (kind === 'nodes')
      downloadCSV('jalnetra_sensor_readings_SIMULATED.csv', Object.values(sim.nodes).map((n) => ({ node_id: n.id, village_id: n.villageId, kind: n.kind, timestamp: new Date(sim.simTime).toISOString(), ...n.current, status: derived.nodes[n.id].status, risk: derived.nodes[n.id].risk, fault: n.fault, comms: n.comms, simulated: true })));
    if (kind === 'supply')
      downloadCSV('jalnetra_supply_history_30d_SIMULATED.csv', sim.villageOrder.flatMap((v) => sim.supplyHistory[v].map((d) => ({ village_id: v, ...d, simulated: true }))));
    if (kind === 'health')
      downloadCSV('jalnetra_health_13wk_SIMULATED.csv', sim.villageOrder.flatMap((v) => sim.health[v].map((w) => ({ ...w }))));
    if (kind === 'pipeline')
      downloadCSV('jalnetra_pipeline_balance_SIMULATED.csv', sim.segments.filter((x) => x.kind !== 'service').map((x) => ({ segment_id: x.id, district: x.districtId, village_id: x.villageId ?? '', ...derived.segments[x.id], simulated: true })));
    if (kind === 'history') {
      const n = sim.nodes[histNode];
      downloadCSV(`jalnetra_${histNode}_15min_30d_SIMULATED.csv`, [...nodeHistory(n, sim.startTime, sim.seed, sim.events), ...(sim.liveBuffer[histNode] ?? [])].map((x) => ({ node_id: histNode, timestamp: new Date(x.t).toISOString(), ...x.v, simulated: true })));
    }
  };

  const onImport = async (file: File) => {
    const rows = parseCSV(await file.text());
    if (!rows.length) return setMsg('No rows found.');
    if ('node_id' in rows[0] && 'param' in rows[0]) {
      const n = s.importReadings(rows.map((r) => ({ nodeId: r.node_id, param: r.param as Param, value: Number(r.value) })));
      setMsg(`Imported ${n} sensor readings (long format: node_id,param,value).`);
    } else if ('node_id' in rows[0]) {
      const params: Param[] = ['ph', 'tds', 'turbidity', 'chlorine', 'flow', 'pressure'];
      const long = rows.flatMap((r) => params.filter((p) => r[p] !== undefined && r[p] !== '').map((p) => ({ nodeId: r.node_id, param: p, value: Number(r[p]) })));
      const n = s.importReadings(long);
      setMsg(`Imported ${n} sensor values (wide format: node_id,ph,tds,…).`);
    } else if ('village_id' in rows[0]) {
      const n = s.importVillages(rows.map((r) => ({ villageId: r.village_id, population: r.population ? Number(r.population) : undefined, supplyMLD: r.supply_mld ? Number(r.supply_mld) : undefined })));
      setMsg(`Updated ${n} villages (village_id,population,supply_mld).`);
    } else setMsg('Unrecognised CSV. Expected columns node_id,param,value — or node_id,ph,tds,… — or village_id,population,supply_mld.');
  };

  const toggleIngest = () => {
    if (s.ingestConnected) {
      disconnectRef.current?.();
      s.setIngestConnected(false);
      return;
    }
    disconnectRef.current = connectTelemetry(
      (p) => {
        setPackets((c) => c + 1);
        const rows = Object.entries(p.readings).map(([param, value]) => ({ nodeId: p.node_id, param: param as Param, value: value as number }));
        useStore.getState().importReadings(rows);
      },
      (open) => useStore.getState().setIngestConnected(open),
    );
  };

  const thNum = (path: string, label: string, step = 0.1) => {
    const [a, b] = path.split('.') as [keyof Thresholds, string?];
    const cur = b ? (s.thresholds[a] as Record<string, number>)[b] : (s.thresholds[a] as number);
    return (
      <label className="flex items-center justify-between gap-2 text-[12px] text-slate-300">
        {label}
        <input type="number" step={step} className="inp w-[80px] !py-0.5 text-right font-mono" value={cur} onChange={(e) => {
          const v = Number(e.target.value);
          if (!Number.isFinite(v)) return;
          s.setThresholds(b ? { [a]: { ...(s.thresholds[a] as object), [b]: v } } as Partial<Thresholds> : ({ [a]: v } as Partial<Thresholds>));
        }} />
      </label>
    );
  };

  const targets = targetKind === 'district' ? sim.districts.map((d) => [d.id, d.name]) : targetKind === 'node' ? Object.values(sim.nodes).map((n) => [n.id, `${n.id} (${sim.villages[n.villageId].name})`]) : sim.villageOrder.map((v) => [v, `${sim.villages[v].name} (${sim.districts.find((d) => d.id === sim.villages[v].districtId)?.name})`]);

  return (
    <div>
      <PageHeader title="Data & Simulation Controls" subtitle="Synthetic data generation engine, abnormal-event injection, import/export, simulation clock and configurable thresholds. Every record produced here is labelled simulated." />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Districts" value={sim.districts.length} />
        <Stat label="Villages" value={sim.villageOrder.length} />
        <Stat label="Sensor nodes" value={Object.keys(sim.nodes).length} />
        <Stat label="Pipeline segments" value={sim.segments.length} />
        <Stat label="15-min samples / node" value="2,880" unit="30 d" />
        <Stat label="Supply history" value="30" unit="days" />
        <Stat label="Health surveillance" value="13" unit="weeks (91 d)" />
        <Stat label="Dataset seed" value={sim.seed} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <Card title={<><Database size={14} className="text-teal-400" /> Dataset</>} bodyClass="p-3 space-y-3">
          <div className="flex gap-2">
            <input className="inp flex-1 font-mono" value={seed} onChange={(e) => setSeed(e.target.value)} aria-label="Seed" />
            <button className="btn btn-primary" onClick={() => s.newDataset(Number(seed) || undefined)}><RefreshCw size={12} /> Generate with seed</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => { const n = Math.floor(Math.random() * 1e9); setSeed(String(n)); s.newDataset(n); }}><RefreshCw size={12} /> Generate new random dataset</button>
            <button className="btn btn-danger" onClick={() => s.resetSimulation()}><RotateCcw size={12} /> Reset entire simulation</button>
          </div>
          <Notice>Reset regenerates the dataset from the current seed, clearing all overrides, events, alerts and history. Relationships are built in: turbidity ↔ chlorine demand ↔ ORP, flow ↔ LPCD, population ↔ demand, pipeline loss ↔ downstream deficit, quality ↔ synthetic case incidence.</Notice>
        </Card>

        <Card title={<><Play size={14} className="text-teal-400" /> Simulation clock</>} bodyClass="p-3 space-y-3">
          <div className="font-mono text-sm text-white">{fmtTime(sim.simTime)} <span className="text-xs text-slate-500">(started {fmtTime(sim.startTime)})</span></div>
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={() => s.setRunning(!s.running)}>{s.running ? <Pause size={12} /> : <Play size={12} />} {s.running ? 'Pause' : 'Resume'}</button>
            <button className="btn" onClick={() => s.tick()}>Step +15 min × speed</button>
            {[1, 2, 4, 8, 16].map((x) => <button key={x} className={`btn ${s.speed === x ? 'btn-primary' : ''}`} onClick={() => s.setSpeed(x)}>{x}×</button>)}
          </div>
          <div className="text-[11.5px] text-slate-400">Each tick advances 15 simulated minutes × speed every 3 s. Sensors drift around their baselines with diurnal patterns, noise and occasional faults; overridden values are held.</div>
        </Card>

        <Card title={<><Zap size={14} className="text-teal-400" /> Add abnormal event</>} bodyClass="p-3 space-y-2">
          <select className="inp w-full" value={evType} onChange={(e) => setEvType(e.target.value as EventType)} aria-label="Event type">
            {(Object.keys(EVENT_LABELS) as EventType[]).map((t) => <option key={t} value={t}>{EVENT_LABELS[t].label}</option>)}
          </select>
          <div className="text-[11.5px] text-slate-400">{EVENT_LABELS[evType].description}</div>
          <select className="inp w-full" value={evTarget} onChange={(e) => setEvTarget(e.target.value)} aria-label="Event target">
            {targets.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
          </select>
          <button className="btn btn-danger" onClick={() => s.addEvent(evType, evTarget)}><Zap size={12} /> Inject event</button>
          <div className="lbl pt-1">Events ({sim.events.filter((e) => e.active).length} active)</div>
          <div className="max-h-[170px] space-y-1 overflow-y-auto">
            {[...sim.events].reverse().map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-navy-700 px-2 py-1 text-[11.5px]">
                <span className="min-w-0 truncate">{EVENT_LABELS[e.type].label} · {e.label}</span>
                {e.active ? <button className="btn !py-0.5" onClick={() => s.resolveEvent(e.id)}>Resolve</button> : <span className="text-green-300">resolved</span>}
              </div>
            ))}
          </div>
        </Card>

        <Card title={<><Download size={14} className="text-teal-400" /> Export CSV</>} bodyClass="p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button className="btn" onClick={() => exportAll('villages')}>Villages & population</button>
            <button className="btn" onClick={() => exportAll('nodes')}>Current sensor readings</button>
            <button className="btn" onClick={() => exportAll('supply')}>30-day supply history</button>
            <button className="btn" onClick={() => exportAll('health')}>Health surveillance</button>
            <button className="btn" onClick={() => exportAll('pipeline')}>Pipeline water balance</button>
          </div>
          <div className="flex gap-2">
            <select className="inp flex-1" value={histNode} onChange={(e) => setHistNode(e.target.value)} aria-label="Node for history export">
              {Object.keys(sim.nodes).map((n) => <option key={n}>{n}</option>)}
            </select>
            <button className="btn" onClick={() => exportAll('history')}>15-min history</button>
          </div>
        </Card>

        <Card title={<><Upload size={14} className="text-teal-400" /> Import CSV</>} bodyClass="p-3 space-y-2">
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          <button className="btn btn-primary" onClick={() => fileRef.current?.click()}><Upload size={12} /> Choose CSV file</button>
          <div className="text-[11.5px] text-slate-400">Accepted formats:<br />• <code>node_id,param,value</code> (long)<br />• <code>node_id,ph,tds,turbidity,chlorine,flow,pressure</code> (wide — the “Current sensor readings” export round-trips)<br />• <code>village_id,population,supply_mld</code></div>
          {msg && <Notice>{msg}</Notice>}
        </Card>

        <Card title={<><Plug size={14} className="text-teal-400" /> IoT ingestion gateway (backend)</>} bodyClass="p-3 space-y-2">
          <div className="flex items-center justify-between text-[12px]"><span>FastAPI backend</span><SevBadge s={s.backend.online ? 'normal' : 'warning'} label={s.backend.online ? 'Online' : 'Offline'} /></div>
          <div className="flex items-center justify-between text-[12px]"><span>WebSocket /ws/telemetry</span><SevBadge s={s.ingestConnected ? 'normal' : 'warning'} label={s.ingestConnected ? `Connected · ${packets} packets` : 'Not connected'} /></div>
          <button className="btn" disabled={!s.backend.online || !s.backend.ingest} onClick={toggleIngest}><Plug size={12} /> {s.ingestConnected ? 'Disconnect' : 'Connect to ingestion stream'}</button>
          <div className="text-[11.5px] text-slate-400">MQTT-style JSON packets (ESP32 → LoRaWAN/GSM gateway → <code>POST /api/ingest</code>) are broadcast on the WebSocket and applied to matching node IDs. Run <code>python backend/scripts/esp32_simulator.py</code> to emit simulated device packets.{s.backend.online && !s.backend.ingest && <> <span className="text-amber-300">This deployment runs on serverless functions, which cannot hold WebSockets — live streaming is available when the backend runs as a server (uvicorn).</span></>}</div>
        </Card>

        <Card title={<><Sliders size={14} className="text-teal-400" /> Configurable thresholds</>} className="lg:col-span-2 xl:col-span-3" right={<button className="btn !py-0.5" onClick={() => s.setThresholds(DEFAULT_THRESHOLDS)}><RotateCcw size={12} /> Defaults</button>} bodyClass="p-3">
          <div className="grid gap-x-6 gap-y-2 md:grid-cols-2 xl:grid-cols-4">
            {thNum('chlorine.lowWarn', 'FRC low warning (mg/L)', 0.01)}
            {thNum('chlorine.lowCrit', 'FRC low critical (mg/L)', 0.01)}
            {thNum('chlorine.highWarn', 'FRC high warning (mg/L)', 0.1)}
            {thNum('turbidity.warn', 'Turbidity warning (NTU)')}
            {thNum('turbidity.crit', 'Turbidity critical (NTU)')}
            {thNum('tds.warn', 'TDS warning (mg/L)', 10)}
            {thNum('tds.crit', 'TDS critical (mg/L)', 10)}
            {thNum('ph.lowWarn', 'pH low warning', 0.1)}
            {thNum('ph.highWarn', 'pH high warning', 0.1)}
            {thNum('ph.lowCrit', 'pH low critical', 0.1)}
            {thNum('ph.highCrit', 'pH high critical', 0.1)}
            {thNum('orp.lowWarn', 'ORP low warning (mV)', 5)}
            {thNum('flowRatio.warn', 'Flow warning (× baseline)', 0.05)}
            {thNum('flowRatio.crit', 'Flow critical (× baseline)', 0.05)}
            {thNum('pressure.lowWarn', 'Pressure low warning (bar)', 0.05)}
            {thNum('pressure.lowCrit', 'Pressure low critical (bar)', 0.05)}
            {thNum('lpcdNorm', 'LPCD norm', 5)}
            {thNum('lpcdWarnPct', 'Supply warning (% of norm)', 1)}
            {thNum('lpcdCritPct', 'Supply critical (% of norm)', 1)}
            {thNum('lossTolerancePct', 'Water-loss tolerance (%)', 0.5)}
            {thNum('lossUncertaintyPct', 'Uncertainty band (%)', 0.5)}
            {thNum('lossCritPct', 'Loss critical (%)', 0.5)}
            {thNum('healthWarn', 'Health watch score', 1)}
            {thNum('forecastDeficitPct', 'Forecast shortage (%)', 1)}
          </div>
          <div className="mt-2 text-[11px] text-slate-500">Defaults follow BIS IS 10500:2012 (pH, TDS, turbidity, residual chlorine) and illustrative operational limits (ORP, flow, pressure, loss tolerance). Changing a threshold immediately re-evaluates every node, village, segment and alert.</div>
        </Card>
      </div>
    </div>
  );
}
