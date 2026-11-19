import { useMemo, useState } from 'react';
import { RotateCcw, Zap } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import MapView from '../components/MapView';
import { Card, chartTooltip, Notice, PageHeader, SERIES, SevBadge, Stat, STATUS, Tabs } from '../components/ui';
import { LOSS_LABEL } from '../engine/compute';
import { gauss, hashString, mulberry32, round } from '../engine/rng';
import { useStore } from '../store';

export default function PipelinePage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const th = useStore((s) => s.thresholds);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectSegment = useStore((s) => s.selectSegment);
  const selectVillage = useStore((s) => s.selectVillage);
  const setParam = useStore((s) => s.setParam);
  const restoreNode = useStore((s) => s.restoreNode);
  const setSegmentUpstream = useStore((s) => s.setSegmentUpstream);
  const setSegmentAuth = useStore((s) => s.setSegmentAuth);
  const addEvent = useStore((s) => s.addEvent);
  const [kind, setKind] = useState<'flagged' | 'distribution' | 'transmission'>('flagged');

  const segs = sim.segments
    .filter((s) => s.kind === 'distribution' || s.kind === 'transmission')
    .filter((s) => (kind === 'flagged' ? derived.segments[s.id].severity !== 'normal' : s.kind === kind))
    .sort((a, b) => derived.segments[b.id].lossPct - derived.segments[a.id].lossPct);
  const segId = selectedSegmentId && sim.segments.find((s) => s.id === selectedSegmentId && s.kind !== 'service' && s.kind !== 'intake') ? selectedSegmentId : segs[0]?.id ?? `seg-d-${sim.villageOrder[0]}`;
  const seg = sim.segments.find((s) => s.id === segId)!;
  const sd = derived.segments[segId];
  const v = seg.villageId ? sim.villages[seg.villageId] : undefined;
  const inlet = v ? sim.nodes[v.nodeIds[0]] : undefined;
  const name = seg.kind === 'transmission' ? `${sim.districts.find((d) => d.id === seg.districtId)?.name} transmission main (WTP → district reservoir)` : `${v?.name} distribution main (district reservoir → village tank)`;

  const lossHistory = useMemo(() => {
    const r = mulberry32(hashString(sim.seed + segId));
    const hist = Array.from({ length: 30 }, (_, i) => ({ day: sim.supplyHistory[sim.villageOrder[0]][i].day.slice(5), loss: round(Math.max(0, seg.baseLossFactor * 100 + gauss(r) * 1.1), 2) }));
    return [...hist, { day: 'Live', loss: sd.lossPct }];
  }, [segId, sim.seed, sd.lossPct, seg.baseLossFactor, sim.supplyHistory, sim.villageOrder]);

  // District reservoir balance
  const t = derived.segments[`seg-t-${seg.districtId}`];
  const distSegs = sim.segments.filter((s) => s.kind === 'distribution' && s.districtId === seg.districtId);
  const outflowMLD = distSegs.reduce((a, s) => a + (derived.segments[s.id].upstream * sim.villages[s.villageId!].supplyHours * 60) / 1e6, 0);

  return (
    <div>
      <PageHeader title="Pipeline Integrity & Leakage Detection" subtitle="Water balance on every monitored segment: Loss = Upstream inflow − Downstream measured outflow − Accounted authorised consumption. The detector separates suspected leakage, possible unauthorised draw-off, measurement uncertainty and upstream disruption — it never labels a gap as theft." />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Card title="Monitored segments" right={<Tabs value={kind} onChange={setKind} items={[{ id: 'flagged', label: `Flagged (${sim.segments.filter((s) => (s.kind === 'distribution' || s.kind === 'transmission') && derived.segments[s.id].severity !== 'normal').length})` }, { id: 'distribution', label: 'Distribution' }, { id: 'transmission', label: 'Transmission' }]} />} bodyClass="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead><tr><th>Segment</th><th>Up</th><th>Down</th><th>Loss %</th><th>Classification</th></tr></thead>
            <tbody>
              {segs.map((s) => {
                const d = derived.segments[s.id];
                return (
                  <tr key={s.id} onClick={() => selectSegment(s.id)} className={`cursor-pointer ${s.id === segId ? 'bg-teal-500/10' : ''}`}>
                    <td className="whitespace-nowrap">{s.kind === 'transmission' ? `${sim.districts.find((x) => x.id === s.districtId)?.name} (T)` : sim.villages[s.villageId!].name}</td>
                    <td className="font-mono">{d.upstream}</td>
                    <td className="font-mono">{d.downstream}</td>
                    <td className="font-mono" style={{ color: d.severity === 'normal' ? undefined : STATUS[d.severity] }}>{d.lossPct}</td>
                    <td><SevBadge s={d.severity} label={LOSS_LABEL[d.classification]} /></td>
                  </tr>
                );
              })}
              {!segs.length && <tr><td colSpan={5} className="text-slate-500">No segments in this view.</td></tr>}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card title={<span className="truncate">{name}</span>} right={<SevBadge s={sd.severity} label={LOSS_LABEL[sd.classification]} />} bodyClass="p-3 space-y-3">
            <div className="rounded-lg border border-navy-700 bg-navy-950 p-3 font-mono text-[13px]">
              <div className="text-slate-400">Water balance ({sd.unit})</div>
              <div className="mt-1 text-white">
                {sd.upstream} <span className="text-slate-500">upstream</span> − {sd.downstream} <span className="text-slate-500">downstream</span> − {sd.authorised} <span className="text-slate-500">authorised</span> = <b style={{ color: STATUS[sd.severity] }}>{sd.loss}</b>
              </div>
              <div className="mt-1">Loss <b style={{ color: STATUS[sd.severity] }}>{sd.lossPct}%</b> · tolerance {th.lossTolerancePct}% · uncertainty band +{th.lossUncertaintyPct}% · critical ≥ {th.lossCritPct}% · downstream pressure {round(sd.pressureRatio * 100, 0)}% of baseline</div>
            </div>
            <p className="text-[12.5px] text-slate-300">{sd.note}</p>

            {seg.kind === 'distribution' && inlet && (
              <div className="space-y-2.5 rounded-lg border border-navy-700 p-3">
                <div className="lbl">Adjust the meters (what-if)</div>
                <Ctl label="Upstream flow (reservoir outlet)" unit="L/min" min={0} max={round(seg.baseUpstream * 1.6, 0)} step={1} value={sd.upstream} onChange={(x) => setSegmentUpstream(seg.id, x)} />
                <Ctl label="Downstream flow (village inlet meter)" unit="L/min" min={0} max={round(seg.baseUpstream * 1.6, 0)} step={1} value={inlet.current.flow} onChange={(x) => setParam(inlet.id, 'flow', x)} />
                <Ctl label="Downstream pressure" unit="bar" min={0} max={6} step={0.05} value={inlet.current.pressure} onChange={(x) => setParam(inlet.id, 'pressure', x)} />
                <Ctl label="Accounted authorised consumption" unit="%" min={0} max={20} step={0.5} value={seg.authorisedPct} onChange={(x) => setSegmentAuth(seg.id, x)} />
                <div className="flex flex-wrap gap-2 pt-1">
                  <button className="btn" onClick={() => { setSegmentUpstream(seg.id, undefined); restoreNode(inlet.id, ['flow', 'pressure']); setSegmentAuth(seg.id, round(seg.authorisedPct, 1)); }}>
                    <RotateCcw size={12} /> Restore meters
                  </button>
                  <button className="btn btn-danger" onClick={() => addEvent('pipeline-leak', v!.id)}><Zap size={12} /> Inject leak</button>
                  <button className="btn btn-danger" onClick={() => addEvent('illegal-tapping', v!.id)}><Zap size={12} /> Inject unaccounted draw-off</button>
                  <button className="btn btn-danger" onClick={() => addEvent('pump-failure', v!.id)}><Zap size={12} /> Inject pump failure</button>
                  <button className="btn" onClick={() => selectVillage(v!.id)}>Select village</button>
                </div>
                <div className="text-[10.5px] text-slate-500">Injected events are resolvable from Data & Simulation Controls. Try: lower downstream flow only → “possible unauthorised draw-off”; also lower pressure → “suspected leakage”; lower both meters → “disruption”.</div>
              </div>
            )}
            {seg.kind === 'transmission' && (
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-danger" onClick={() => addEvent('main-burst', seg.districtId)}><Zap size={12} /> Inject transmission main burst</button>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Reservoir inflow" value={t ? t.downstream : '—'} unit="MLD" />
              <Stat label="Reservoir outflow" value={round(outflowMLD, 3)} unit="MLD" />
              <Stat label="Transmission loss" value={t ? `${t.lossPct}%` : '—'} s={t?.severity} />
              <Stat label="District loss" value={`${derived.districts[seg.districtId].lossPct}%`} s={derived.districts[seg.districtId].pipelineStatus} />
            </div>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Historical water balance (loss %)">
              <div className="h-[190px]">
                <ResponsiveContainer>
                  <LineChart data={lossHistory} margin={{ top: 6, right: 10, left: -18, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={20} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                    <Tooltip {...chartTooltip} />
                    <ReferenceLine y={th.lossTolerancePct} stroke={STATUS.warning} strokeDasharray="4 4" />
                    <ReferenceLine y={th.lossCritPct} stroke={STATUS.critical} strokeDasharray="4 4" />
                    <Line dataKey="loss" name="Loss %" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <MapView height={230} compact focusVillageId={seg.villageId ?? sim.villageOrder.find((x) => sim.villages[x].districtId === seg.districtId)} />
          </div>
          <Notice>Bulk meter readings are simulated. In practice, confirm any balance gap with portable flow measurement and meter calibration before field action; unexplained differences can stem from meter error, unmetered authorised use or leakage.</Notice>
        </div>
      </div>
    </div>
  );
}

function Ctl({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3">
      <span className="text-[12px] text-slate-300">{label}</span>
      <span className="font-mono text-[12px] text-white">{value} {unit}</span>
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="col-span-2 w-full" />
    </div>
  );
}
