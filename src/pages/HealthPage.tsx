import { Download, HeartPulse } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts';
import FilterBar from '../components/FilterBar';
import { barCursor, Card, chartTooltip, Meter, Notice, PageHeader, SERIES, SevBadge, SevIcon, Stat, STATUS } from '../components/ui';
import { healthCorrelation } from '../engine/assistant';
import { downloadCSV } from '../lib/export';
import { useStore, villagesInFilter } from '../store';

export default function HealthPage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const alerts = useStore((s) => s.alerts);
  const filters = useStore((s) => s.filters);
  const th = useStore((s) => s.thresholds);
  const fc = useStore((s) => s.forecast);
  const selectedVillageId = useStore((s) => s.selectedVillageId);
  const selectVillage = useStore((s) => s.selectVillage);
  const setPage = useStore((s) => s.setPage);

  const vids = villagesInFilter({ sim, filters });
  const ranked = [...vids].sort((a, b) => derived.villages[b].healthPriority - derived.villages[a].healthPriority);
  const vid = selectedVillageId && vids.includes(selectedVillageId) ? selectedVillageId : ranked[0];
  const v = sim.villages[vid];
  const vd = derived.villages[vid];
  const weeks = sim.health[vid].map((w, i) => ({ week: w.weekStart.slice(5), Diarrhoea: w.diarrhoea + (i === 12 ? sim.todayCases[vid] ?? 0 : 0), Typhoid: w.typhoid, Cholera: w.cholera, GI: w.giSymptoms, risk: w.waterRiskIndicator }));
  const corr = healthCorrelation({ state: sim, derived, alerts, th, fc });
  const scatter = vids.map((x) => ({ name: sim.villages[x].name, water: derived.villages[x].healthComponents.water, cases: derived.villages[x].recentCasesPer10k, pop: sim.villages[x].population, s: derived.villages[x].healthStatus }));
  const wn = sim.nodes[vd.worstNodeId].current;
  const trend = vd.caseTrendRatio > 1.3 ? 'Increasing' : vd.caseTrendRatio < 0.8 ? 'Decreasing' : 'Stable';
  const watchCount = vids.filter((x) => derived.villages[x].healthStatus !== 'normal').length;

  const exportHealth = () =>
    downloadCSV(
      'jalnetra_health_surveillance_SIMULATED.csv',
      sim.villageOrder.flatMap((x) => sim.health[x].map((w) => ({ village_id: w.villageId, week_start: w.weekStart, suspected_diarrhoea: w.diarrhoea, suspected_typhoid: w.typhoid, suspected_cholera: w.cholera, gi_symptoms: w.giSymptoms, population: w.population, water_risk_indicator: w.waterRiskIndicator, simulated: true }))),
    );

  return (
    <div>
      <PageHeader
        title="Waterborne Disease Early Warning"
        subtitle="Links live water-quality anomalies with anonymised synthetic surveillance data (suspected cholera, typhoid and acute diarrhoeal disease) to prioritise inspection and health-worker follow-up."
        right={<button className="btn" onClick={exportHealth}><Download size={12} /> Export synthetic dataset (CSV)</button>}
      />
      <Notice tone="warn">
        <b>Early-warning and prioritisation tool only.</b> It does not diagnose disease or confirm outbreaks. Water-quality anomalies and synthetic case counts are not proof of causation. All health records are synthetic, aggregated and contain no personal identifiers.
      </Notice>
      <div className="mt-3"><FilterBar showDays={false} showSeverity={false} /></div>
      <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card title={<><HeartPulse size={14} className="text-teal-400" /> Inspection priority ranking ({watchCount} on watch)</>} bodyClass="max-h-[760px] overflow-auto p-2 space-y-1">
          {ranked.slice(0, 60).map((x, i) => {
            const d = derived.villages[x];
            return (
              <button key={x} onClick={() => selectVillage(x)} className={`w-full rounded-lg border px-2.5 py-1.5 text-left ${x === vid ? 'border-teal-500/60 bg-teal-500/10' : 'border-navy-700 hover:border-navy-500'}`}>
                <div className="flex items-center justify-between text-[12px]">
                  <span className="flex items-center gap-1.5"><span className="w-5 font-mono text-slate-500">{i + 1}</span><SevIcon s={d.healthStatus} size={12} /> {sim.villages[x].name}</span>
                  <span className="font-mono text-white">{d.healthPriority}</span>
                </div>
                <div className="mt-1"><Meter value={d.healthPriority} s={d.healthStatus} /></div>
              </button>
            );
          })}
        </Card>

        <div className="space-y-4">
          <div className={`card border-2 p-4 ${vd.healthStatus === 'critical' ? 'border-red-500/60' : vd.healthStatus === 'warning' ? 'border-amber-500/50' : 'border-green-500/30'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-lg font-bold tracking-tight text-white">
                {vd.healthStatus === 'critical' ? 'PUBLIC HEALTH WATCH' : vd.healthStatus === 'warning' ? 'HEALTH SURVEILLANCE WATCH' : 'NO WATCH'} – {v.name}
              </div>
              <div className="flex items-center gap-2"><SevBadge s={vd.healthStatus} /> <span className="text-[11px] font-semibold text-fuchsia-300">SIMULATED</span></div>
            </div>
            <div className="mt-2 grid gap-4 md:grid-cols-2">
              <div>
                <div className="lbl mb-1">Observed conditions</div>
                <ul className="ml-4 list-disc space-y-0.5 text-[13px] text-slate-200">
                  <li>Free chlorine: <b style={{ color: STATUS[derived.nodes[vd.worstNodeId].params.chlorine.severity] }}>{wn.chlorine} mg/L</b></li>
                  <li>Turbidity: <b style={{ color: STATUS[derived.nodes[vd.worstNodeId].params.turbidity.severity] }}>{wn.turbidity} NTU</b></li>
                  <li>pH: <b>{wn.ph}</b></li>
                  <li>Reported diarrhoeal cases (synthetic): <b>{trend}</b> (×{vd.caseTrendRatio} vs 7-week baseline)</li>
                  <li>Supply: {vd.lpcd} LPCD, {v.supplyHours} h/day</li>
                </ul>
              </div>
              <div>
                <div className="lbl mb-1">Recommended action</div>
                <ul className="ml-4 list-disc space-y-0.5 text-[13px] text-slate-200">
                  {vd.healthStatus === 'normal' ? (
                    <li>Continue routine surveillance and weekly residual-chlorine checks.</li>
                  ) : (
                    <>
                      <li>Conduct immediate confirmatory water sampling.</li>
                      <li>Inspect chlorination equipment.</li>
                      <li>Notify the designated public health officer.</li>
                      <li>Initiate appropriate public health surveillance (ASHA/ANM house visits, IDSP/IHIP reporting).</li>
                    </>
                  )}
                </ul>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Priority score" value={vd.healthPriority} unit="/100" s={vd.healthStatus} />
              <Stat label="Water component (×0.50)" value={vd.healthComponents.water} />
              <Stat label="Case-trend component (×0.35)" value={vd.healthComponents.trend} />
              <Stat label="Supply-stress component (×0.15)" value={vd.healthComponents.supply} />
            </div>
            <div className="mt-2 flex gap-2">
              <button className="btn" onClick={() => { selectVillage(vid); setPage('grid'); }}>Open sensor panel</button>
              <span className="self-center text-[11px] text-slate-500">Watch ≥ {th.healthWarn}, public health watch ≥ {th.healthCrit}</span>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={`Weekly suspected cases — ${v.name} (13 weeks)`}>
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={weeks} margin={{ top: 6, right: 6, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                    <Tooltip {...chartTooltip} cursor={barCursor} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Diarrhoea" stackId="a" fill={SERIES[0]} isAnimationActive={false} />
                    <Bar dataKey="Typhoid" stackId="a" fill={SERIES[2]} isAnimationActive={false} />
                    <Bar dataKey="Cholera" stackId="a" fill={SERIES[3]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-[10.5px] text-slate-500">Current week includes cases accrued during this simulation run (lagged response to sustained poor disinfection).</div>
            </Card>
            <Card title="Weekly water-risk indicator (/100)">
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <LineChart data={weeks} margin={{ top: 6, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip {...chartTooltip} />
                    <Line dataKey="risk" name="Water risk" stroke={SERIES[1]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Correlation engine — water-quality component vs recent suspected cases per 10,000" right={<span className="font-mono text-[12px] text-slate-300">r = {corr.current} (villages) · r = {corr.weekly} (village-weeks)</span>}>
            <div className="h-[260px]">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 6, right: 16, left: -10, bottom: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="water" name="Water-quality component" tick={{ fontSize: 10 }} domain={[0, 100]} label={{ value: 'Water-quality component (0–100)', fill: '#94a3b8', fontSize: 10, position: 'insideBottom', offset: -4 }} />
                  <YAxis type="number" dataKey="cases" name="Cases / 10k / week" tick={{ fontSize: 10 }} />
                  <ZAxis type="number" dataKey="pop" range={[40, 220]} name="Population" />
                  <Tooltip {...chartTooltip} formatter={(val: number, n: string) => [val, n]} labelFormatter={() => ''} />
                  {(['normal', 'warning', 'critical'] as const).map((s) => (
                    <Scatter key={s} name={s} data={scatter.filter((p) => p.s === s)} fill={STATUS[s]} fillOpacity={0.75} stroke="#0a1630" strokeWidth={1} isAnimationActive={false} onClick={(p: { name: string }) => { const id = sim.villageOrder.find((x) => sim.villages[x].name === p.name); if (id) selectVillage(id); }} />
                  ))}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
            <div className="text-[11px] text-slate-500">Each dot is a village (colour = health watch status, size = population). A positive r means villages with weaker disinfection indicators also report more suspected cases in this synthetic dataset — an association used for prioritisation, not evidence of causation.</div>
          </Card>
        </div>
      </div>
    </div>
  );
}
