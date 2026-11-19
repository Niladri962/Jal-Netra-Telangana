import { useMemo, useState } from 'react';
import { Bot, MapPin, RotateCcw, Radio, X } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { seriesFor } from '../engine/history';
import { PARAM_INFO } from '../engine/thresholds';
import { EDITABLE_PARAMS, type Param } from '../engine/types';
import { useStore } from '../store';
import { Card, chartTooltip, fmtNum, fmtTime, Meter, SERIES, SevBadge, SevIcon, SimTag, Stat, STATUS, Tabs } from './ui';

function thresholdLines(p: Param, th: ReturnType<typeof useStore.getState>['thresholds'], baseFlow: number) {
  switch (p) {
    case 'chlorine':
      return [th.chlorine.lowWarn, th.chlorine.lowCrit];
    case 'turbidity':
      return [th.turbidity.warn, th.turbidity.crit];
    case 'tds':
      return [th.tds.warn];
    case 'ph':
      return [th.ph.lowWarn, th.ph.highWarn];
    case 'flow':
      return [baseFlow * th.flowRatio.warn, baseFlow * th.flowRatio.crit];
    case 'pressure':
      return [th.pressure.lowWarn];
    case 'orp':
      return [th.orp.lowWarn];
  }
}

export default function VillagePanel({ villageId, onClose, compact = false }: { villageId: string; onClose?: () => void; compact?: boolean }) {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const alerts = useStore((s) => s.alerts);
  const th = useStore((s) => s.thresholds);
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const selectVillage = useStore((s) => s.selectVillage);
  const setParam = useStore((s) => s.setParam);
  const restoreNode = useStore((s) => s.restoreNode);
  const restoreVillage = useStore((s) => s.restoreVillage);
  const askAssistant = useStore((s) => s.askAssistant);
  const [chartParam, setChartParam] = useState<Param>('chlorine');
  const [hours, setHours] = useState<'24' | '168' | '720'>('24');

  const v = sim.villages[villageId];
  const vd = derived.villages[villageId];
  const district = sim.districts.find((d) => d.id === v.districtId)!;
  const nodeId = selectedNodeId && v.nodeIds.includes(selectedNodeId) ? selectedNodeId : v.nodeIds[v.nodeIds.length - 1];
  const node = sim.nodes[nodeId];
  const ne = derived.nodes[nodeId];
  const active = alerts.filter((a) => a.status === 'active' && a.villageId === villageId);
  const recentResolved = alerts.filter((a) => a.status === 'resolved' && a.villageId === villageId).slice(-3).reverse();

  const series = useMemo(
    () => seriesFor(node, sim.startTime, sim.seed, sim.events, sim.liveBuffer[nodeId] ?? [], Number(hours)).map((p) => ({ ...p, label: fmtTime(p.t) })),
    [node, sim.startTime, sim.seed, sim.events, sim.liveBuffer, nodeId, hours],
  );

  const issues = (Object.keys(ne.params) as Param[]).filter((p) => ne.params[p].severity !== 'normal');

  return (
    <Card
      className="flex h-full flex-col"
      bodyClass="flex-1 overflow-y-auto p-3 space-y-3"
      title={
        <>
          <MapPin size={14} className="text-teal-400" />
          <span className="truncate">{v.name}</span>
          <SimTag text="SIM" />
          <SevBadge s={vd.status} />
        </>
      }
      right={
        <>
          <button className="btn" onClick={() => askAssistant(`Why is ${v.name} showing a ${vd.status === 'critical' ? 'red' : vd.status === 'warning' ? 'amber' : 'green'} status?`)} title="Ask JalNetra AI">
            <Bot size={13} /> Ask AI
          </button>
          {onClose && (
            <button className="btn !px-1.5" onClick={onClose} aria-label="Close panel">
              <X size={14} />
            </button>
          )}
        </>
      }
    >
      <div className="text-[12px] text-slate-400">
        {v.mandal} mandal · {district.name} district · {v.lat.toFixed(3)}°N, {v.lng.toFixed(3)}°E · Pop. {fmtNum(v.population)}
        {v.population !== v.basePopulation && <span className="text-amber-300"> (edited)</span>}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Quality risk" value={vd.qualityRisk} unit="/100" s={vd.qualityStatus} />
        <Stat label="Supply" value={vd.lpcd} unit="LPCD" s={vd.supplyStatus} />
        <Stat label="Health priority" value={vd.healthPriority} unit="/100" s={vd.healthStatus} />
        <Stat label="Equity score" value={vd.equityScore} unit="/100" s={vd.equityStatus} />
        <Stat label="Daily supply" value={fmtNum(vd.supplyKL, 1)} unit="kL" />
        <Stat label="Daily demand" value={fmtNum(vd.demandKL, 1)} unit="kL" />
        <Stat label="Supply hours" value={`${v.supplyHours} h`} unit={`${v.supplyDaysPerWeek} d/wk`} />
        <Stat label="7-day forecast" value={fmtNum(vd.forecast.avg7Demand, 0)} unit="kL/d" s={vd.forecast.deficit7Pct > th.forecastDeficitPct ? 'warning' : 'normal'} />
      </div>

      {/* Node selector */}
      <div>
        <div className="lbl mb-1.5 flex items-center gap-1.5">
          <Radio size={11} /> Monitoring nodes ({v.nodeIds.length})
        </div>
        <div className="flex flex-wrap gap-1.5">
          {v.nodeIds.map((nid) => {
            const n = sim.nodes[nid];
            const e = derived.nodes[nid];
            return (
              <button key={nid} onClick={() => selectVillage(villageId, nid)} className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] ${nid === nodeId ? 'border-teal-400 bg-teal-500/10 text-teal-200' : 'border-navy-600 text-slate-300 hover:border-navy-500'}`}>
                <span className="h-2 w-2 rounded-full" style={{ background: n.fault ? STATUS.idle : STATUS[e.status] }} />
                {n.label}
                <span className="font-mono text-slate-500">{e.risk}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-1.5 font-mono text-[10.5px] text-slate-500">
          Sensor {node.id} · {node.comms} · fw {node.firmware} · reading every 15 min {node.fault && <span className="text-amber-300">· FAULT FLAGGED</span>}
        </div>
      </div>

      {/* Sensor sliders */}
      <div className="rounded-lg border border-navy-700 bg-navy-950/50 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="lbl">Live sensor readings — drag to simulate a change</span>
          <button className="btn !py-1" onClick={() => restoreNode(nodeId)} disabled={!Object.keys(node.overrides).length}>
            <RotateCcw size={12} /> Restore node baseline
          </button>
        </div>
        <div className="space-y-2">
          {(['chlorine', 'turbidity', 'tds', 'ph', 'flow', 'pressure', 'orp'] as Param[]).map((p) => {
            const info = PARAM_INFO[p];
            const e = ne.params[p];
            const editable = EDITABLE_PARAMS.includes(p);
            const max = p === 'flow' ? Math.max(200, Math.ceil(node.baseline.flow * 2.5)) : info.max;
            const overridden = node.overrides[p];
            return (
              <div key={p} className="grid grid-cols-[92px_1fr_92px] items-center gap-2">
                <label htmlFor={`sl-${p}`} className="flex items-center gap-1 text-[12px] text-slate-300" title={info.standard}>
                  <SevIcon s={e.severity} size={12} />
                  {info.short}
                </label>
                {editable ? (
                  <input id={`sl-${p}`} type="range" min={info.min} max={max} step={info.step} value={node.current[p]} onChange={(ev) => setParam(nodeId, p, Number(ev.target.value))} className="w-full" />
                ) : (
                  <div className="text-[10.5px] text-slate-500">derived from FRC, pH & turbidity</div>
                )}
                <div className="flex items-center justify-end gap-1">
                  {editable ? (
                    <input
                      aria-label={`${info.label} value`}
                      type="number"
                      step={info.step}
                      value={node.current[p]}
                      onChange={(ev) => ev.target.value !== '' && setParam(nodeId, p, Number(ev.target.value))}
                      className={`inp w-[62px] !px-1.5 !py-0.5 text-right font-mono ${overridden ? '!border-amber-500/60' : ''}`}
                    />
                  ) : (
                    <span className="font-mono text-xs">{node.current[p]}</span>
                  )}
                  <span className="w-7 text-[10px] text-slate-500">{info.unit === 'pH' ? '' : info.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-2 text-[10.5px] text-slate-500">Amber outline = manually overridden value (held until restored). Simulated readings are not certified laboratory measurements.</div>
      </div>

      {/* Explanation & corrective actions */}
      {issues.length > 0 ? (
        <div className="space-y-2">
          {issues.map((p) => {
            const e = ne.params[p];
            const info = PARAM_INFO[p];
            const k = e.direction === 'low' ? info.low : info.high;
            if (!k) return null;
            return (
              <div key={p} className={`rounded-lg border p-2.5 text-[12px] ${e.severity === 'critical' ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
                <div className="mb-1 flex items-center gap-2 font-semibold text-white">
                  <SevIcon s={e.severity} /> {k.title}: {e.value} {info.unit}
                  <SevBadge s={e.severity} />
                </div>
                <p className="text-slate-300">{k.meaning}</p>
                <p className="mt-1 text-slate-400"><span className="text-slate-300">Possible causes:</span> {k.causes.join('; ')}.</p>
                <p className="mt-1 text-slate-400"><span className="text-slate-300">Consequences:</span> {k.consequences.join('; ')}.</p>
                <div className="mt-1.5 text-slate-300">Recommended corrective actions:</div>
                <ul className="ml-4 list-disc text-slate-300">{k.actions.map((a) => <li key={a}>{a}</li>)}</ul>
                <div className="mt-1 text-[10.5px] text-slate-500">Reference: {info.standard}</div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-green-500/30 bg-green-500/5 p-2.5 text-[12px] text-green-200/90">All parameters at this node are within the configured thresholds.</div>
      )}

      {/* Trend */}
      <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
          <span className="lbl">Historical trend — {PARAM_INFO[chartParam].label}</span>
          <div className="flex flex-wrap gap-1.5">
            <Tabs value={chartParam} onChange={setChartParam} items={(['chlorine', 'turbidity', 'tds', 'ph', 'flow', 'pressure', 'orp'] as Param[]).map((p) => ({ id: p, label: PARAM_INFO[p].short }))} />
            <Tabs value={hours} onChange={setHours} items={[{ id: '24', label: '24h' }, { id: '168', label: '7d' }, { id: '720', label: '30d' }]} />
          </div>
        </div>
        <div className="h-[170px]">
          <ResponsiveContainer>
            <LineChart data={series} margin={{ top: 6, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={40} />
              <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
              <Tooltip {...chartTooltip} formatter={(val: number) => [`${val} ${PARAM_INFO[chartParam].unit}`, PARAM_INFO[chartParam].short]} />
              {thresholdLines(chartParam, th, node.baseline.flow).map((y, i) => (
                <ReferenceLine key={i} y={y} stroke={i === 0 ? STATUS.warning : STATUS.critical} strokeDasharray="4 4" />
              ))}
              <Line type="monotone" dataKey={chartParam} stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="text-[10.5px] text-slate-500">15-min synthetic history + live simulated samples. Dashed lines = configured warning / critical thresholds.</div>
      </div>

      {/* Alerts */}
      <div>
        <div className="lbl mb-1.5">Active alerts ({active.length})</div>
        {active.length === 0 && <div className="text-[12px] text-slate-500">No active alerts.</div>}
        <div className="space-y-1.5">
          {active.map((a) => (
            <div key={a.id} className="rounded-lg border border-navy-700 bg-navy-950/60 px-2.5 py-1.5 text-[12px]">
              <div className="flex items-center gap-1.5 font-medium text-slate-200">
                <SevIcon s={a.severity} /> {a.title}
              </div>
              <div className="text-[11px] text-slate-400">
                {a.category} · {a.prevValue !== null ? `${a.prevValue} → ` : ''}
                {a.value} {a.unit} · raised {fmtTime(a.createdSim)} (sim)
              </div>
            </div>
          ))}
          {recentResolved.map((a) => (
            <div key={a.id} className="rounded-lg border border-green-500/20 px-2.5 py-1 text-[11px] text-green-300/80">
              ✓ Resolved: {a.title} at {fmtTime(a.resolvedSim!)}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-navy-700 pt-2">
        <button className="btn" onClick={() => restoreVillage(villageId)}>
          <RotateCcw size={12} /> Restore whole village
        </button>
        {!compact && <Meter value={vd.qualityRisk} s={vd.qualityStatus} />}
      </div>
    </Card>
  );
}
