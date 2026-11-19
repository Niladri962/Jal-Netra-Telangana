import { useMemo } from 'react';
import { Activity, AlertTriangle, Droplet, Gauge, HeartPulse, Home, Radio, ShieldCheck, Users, Waves } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import FilterBar from '../components/FilterBar';
import { barCursor, Card, chartTooltip, fmtNum, Kpi, PageHeader, SERIES, SevIcon, STATUS } from '../components/ui';
import { round } from '../engine/rng';
import { useStore, villagesInFilter } from '../store';

export default function CommandCentre() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const alerts = useStore((s) => s.alerts);
  const filters = useStore((s) => s.filters);
  const th = useStore((s) => s.thresholds);
  const setPage = useStore((s) => s.setPage);
  const selectVillage = useStore((s) => s.selectVillage);

  const vids = villagesInFilter({ sim, filters });
  const sevOk = (s: string) => filters.severity === 'all' || (filters.severity === 'warning' ? s !== 'normal' : s === 'critical');
  const vds = vids.map((v) => derived.villages[v]);
  const districtIds = [...new Set(vids.map((v) => sim.villages[v].districtId))];

  const kpi = useMemo(() => {
    const pop = vids.reduce((a, v) => a + sim.villages[v].population, 0);
    const supply = vds.reduce((a, v) => a + v.supplyKL, 0) / 1000;
    const segIds = new Set(vids.map((v) => `seg-d-${v}`).concat(districtIds.map((d) => `seg-t-${d}`)));
    return {
      villages: vids.length,
      sensors: vids.reduce((a, v) => a + sim.villages[v].nodeIds.length, 0),
      pop,
      supply,
      lpcd: pop ? (supply * 1e6) / pop : 0,
      safe: vds.filter((v) => v.qualityStatus === 'normal').length,
      qAlert: vds.filter((v) => v.qualityStatus !== 'normal').length,
      qCrit: vds.filter((v) => v.qualityStatus === 'critical').length,
      short: vds.filter((v) => v.supplyStatus !== 'normal').length,
      leaks: [...segIds].filter((id) => derived.segments[id] && ['leak', 'unauthorised'].includes(derived.segments[id].classification)).length,
      health: vds.filter((v) => v.healthStatus !== 'normal').length,
    };
  }, [vids, vds, sim, derived, districtIds]);

  const days = sim.supplyHistory[sim.villageOrder[0]].slice(-filters.days).map((d) => d.day);
  const trend = days.map((day, i) => {
    const idx = 30 - filters.days + i;
    const sup = vids.reduce((a, v) => a + sim.supplyHistory[v][idx].suppliedKL, 0) / 1000;
    const dem = vids.reduce((a, v) => a + sim.supplyHistory[v][idx].demandKL, 0) / 1000;
    const risk = vids.reduce((a, v) => a + sim.supplyHistory[v][idx].avgRisk, 0) / Math.max(1, vids.length);
    return { day: day.slice(5), supplied: round(sup, 2), demand: round(dem, 2), risk: round(risk, 1) };
  });
  trend.push({ day: 'Live', supplied: round(kpi.supply, 2), demand: round(vds.reduce((a, v) => a + v.demandKL, 0) / 1000, 2), risk: round(vds.reduce((a, v) => a + v.qualityRisk, 0) / Math.max(1, vds.length), 1) });

  const qualityByDistrict = districtIds.map((id) => {
    const c = { normal: 0, warning: 0, critical: 0 };
    vids.filter((v) => sim.villages[v].districtId === id).forEach((v) => c[derived.villages[v].qualityStatus]++);
    return { name: derived.districts[id].name.split(/[\s–]/)[0], ...c };
  });
  const demandSupply = districtIds.map((id) => {
    const dv = vids.filter((v) => sim.villages[v].districtId === id);
    return { name: derived.districts[id].name.split(/[\s–]/)[0], Supply: round(dv.reduce((a, v) => a + derived.villages[v].supplyKL, 0) / 1000, 3), Demand: round(dv.reduce((a, v) => a + derived.villages[v].demandKL, 0) / 1000, 3) };
  });
  const villageLpcd = vids
    .filter((v) => sevOk(derived.villages[v].supplyStatus) || filters.severity === 'all')
    .map((v) => ({ id: v, name: sim.villages[v].name, lpcd: derived.villages[v].lpcd, s: derived.villages[v].supplyStatus }))
    .sort((a, b) => a.lpcd - b.lpcd)
    .slice(0, 40);
  const losses = districtIds.map((id) => ({ name: derived.districts[id].name.split(/[\s–]/)[0], loss: derived.districts[id].lossPct, s: derived.districts[id].pipelineStatus })).sort((a, b) => b.loss - a.loss);
  const equity = districtIds.map((id) => ({ name: derived.districts[id].name, score: derived.districts[id].equityScore })).sort((a, b) => b.score - a.score);

  const activeAlerts = alerts
    .filter((a) => a.status === 'active' && (!filters.district || a.districtId === filters.district) && (!a.villageId || vids.includes(a.villageId) || !filters.district) && sevOk(a.severity))
    .sort((a, b) => (a.severity === b.severity ? b.updatedSim - a.updatedSim : a.severity === 'critical' ? -1 : 1));

  return (
    <div>
      <PageHeader
        title="Executive Command Centre"
        subtitle="State-level overview of the simulated Mission Bhagiratha-style rural water grid. Every number below is computed live from the simulated sensor network and recalculates on each change."
      />
      <FilterBar />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Villages monitored" value={kpi.villages} icon={<Home size={15} />} sub={`${districtIds.length} districts`} onClick={() => setPage('grid')} />
        <Kpi label="IoT sensor nodes" value={kpi.sensors} icon={<Radio size={15} />} sub="15-min telemetry (sim)" onClick={() => setPage('monitoring')} />
        <Kpi label="Population covered" value={fmtNum(kpi.pop)} icon={<Users size={15} />} sub="simulated habitations" />
        <Kpi label="Water supplied" value={fmtNum(kpi.supply, 2)} unit="MLD" icon={<Waves size={15} />} sub="effective daily" />
        <Kpi label="Avg availability" value={fmtNum(kpi.lpcd, 1)} unit="LPCD" icon={<Droplet size={15} />} s={kpi.lpcd < th.lpcdNorm * (th.lpcdWarnPct / 100) ? 'warning' : 'normal'} sub={`norm ${th.lpcdNorm} LPCD`} onClick={() => setPage('equity')} />
        <Kpi label="Villages with safe water" value={kpi.safe} icon={<ShieldCheck size={15} />} sub={`${round((kpi.safe / Math.max(1, kpi.villages)) * 100, 0)}% of monitored`} onClick={() => setPage('monitoring')} />
        <Kpi label="Villages with quality alerts" value={kpi.qAlert} icon={<AlertTriangle size={15} />} s={kpi.qCrit ? 'critical' : kpi.qAlert ? 'warning' : 'normal'} sub={`${kpi.qCrit} critical`} onClick={() => setPage('monitoring')} />
        <Kpi label="Villages with supply shortage" value={kpi.short} icon={<Gauge size={15} />} s={kpi.short ? 'warning' : 'normal'} sub={`< ${th.lpcdWarnPct}% of norm`} onClick={() => setPage('equity')} />
        <Kpi label="Active leakage / loss alerts" value={kpi.leaks} icon={<Activity size={15} />} s={kpi.leaks ? 'critical' : 'normal'} sub="water-balance detector" onClick={() => setPage('pipeline')} />
        <Kpi label="High-risk public health locations" value={kpi.health} icon={<HeartPulse size={15} />} s={kpi.health ? 'warning' : 'normal'} sub="surveillance watch" onClick={() => setPage('health')} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Daily water supply trend (MLD)" className="xl:col-span-2" right={<span className="text-[11px] text-slate-500">last {filters.days} days + live</span>}>
          <div className="h-[230px]">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...chartTooltip} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="supplied" name="Supplied" stroke={SERIES[0]} fill={SERIES[0]} fillOpacity={0.15} strokeWidth={2} isAnimationActive={false} />
                <Area type="monotone" dataKey="demand" name="Estimated demand" stroke={SERIES[2]} fill="none" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Active alerts" right={<button className="text-[11px] text-teal-300 hover:underline" onClick={() => setPage('alerts')}>View all ({activeAlerts.length})</button>} bodyClass="max-h-[262px] overflow-y-auto p-2">
          {activeAlerts.length === 0 && <div className="p-3 text-xs text-slate-500">No active alerts for this filter.</div>}
          {activeAlerts.slice(0, 30).map((a) => (
            <button
              key={a.id}
              onClick={() => {
                if (a.villageId) selectVillage(a.villageId, a.nodeId);
                setPage(a.category === 'Water loss' ? 'pipeline' : 'grid');
              }}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-navy-800"
            >
              <span className="mt-0.5"><SevIcon s={a.severity} /></span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] text-slate-200">{a.title}</span>
                <span className="block text-[10.5px] text-slate-500">{a.category} · {a.value} {a.unit}</span>
              </span>
            </button>
          ))}
        </Card>

        <Card title="Water quality distribution by district (villages)">
          <div className="h-[230px]">
            <ResponsiveContainer>
              <BarChart data={qualityByDistrict} margin={{ top: 6, right: 6, left: -20, bottom: 30 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-50} textAnchor="end" interval={0} height={40} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip {...chartTooltip} cursor={barCursor} />
                <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
                <Bar dataKey="normal" name="Normal" stackId="a" fill={STATUS.normal} isAnimationActive={false} />
                <Bar dataKey="warning" name="Warning" stackId="a" fill={STATUS.warning} isAnimationActive={false} />
                <Bar dataKey="critical" name="Critical" stackId="a" fill={STATUS.critical} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Water demand vs actual supply (MLD)">
          <div className="h-[230px]">
            <ResponsiveContainer>
              <BarChart data={demandSupply} margin={{ top: 6, right: 6, left: -14, bottom: 30 }} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-50} textAnchor="end" interval={0} height={40} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...chartTooltip} cursor={barCursor} />
                <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
                <Bar dataKey="Supply" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="Demand" fill={SERIES[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Water quality risk trend (avg score / 100)">
          <div className="h-[230px]">
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 6, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={16} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 'auto']} />
                <Tooltip {...chartTooltip} />
                <ReferenceLine y={35} stroke={STATUS.warning} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="risk" name="Avg quality risk" stroke={SERIES[3]} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Village-wise water availability (lowest 40, LPCD)" className="xl:col-span-2">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={villageLpcd} margin={{ top: 6, right: 6, left: -14, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-60} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip {...chartTooltip} cursor={barCursor} formatter={(v: number) => [`${v} LPCD`, 'Availability']} />
                <ReferenceLine y={th.lpcdNorm} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: `${th.lpcdNorm} LPCD norm`, fill: '#94a3b8', fontSize: 10, position: 'insideTopRight' }} />
                <Bar dataKey="lpcd" radius={[3, 3, 0, 0]} isAnimationActive={false} onClick={(d: { id: string }) => { selectVillage(d.id); setPage('grid'); }} cursor="pointer">
                  {villageLpcd.map((v) => (
                    <Cell key={v.id} fill={STATUS[v.s]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10.5px] text-slate-500">Bar colour = supply status (green adequate, amber moderate shortage, red severe). Click a bar to open the village on the map.</div>
        </Card>
        <Card title="Pipeline loss estimate by district (%)">
          <div className="h-[240px]">
            <ResponsiveContainer>
              <BarChart data={losses.slice(0, 15)} layout="vertical" margin={{ top: 0, right: 16, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={78} />
                <Tooltip {...chartTooltip} cursor={barCursor} formatter={(v: number) => [`${v}%`, 'Estimated loss']} />
                <ReferenceLine x={th.lossTolerancePct} stroke={STATUS.warning} strokeDasharray="4 4" />
                <Bar dataKey="loss" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                  {losses.slice(0, 15).map((l) => (
                    <Cell key={l.name} fill={STATUS[l.s]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="District water equity ranking (score / 100)" className="xl:col-span-3">
          <div className="h-[220px]">
            <ResponsiveContainer>
              <BarChart data={equity} margin={{ top: 6, right: 6, left: -14, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-45} textAnchor="end" interval={0} height={50} />
                <YAxis tick={{ fontSize: 10 }} domain={[0, 100]} />
                <Tooltip {...chartTooltip} cursor={barCursor} />
                <Bar dataKey="score" name="Equity score" fill={SERIES[1]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
    </div>
  );
}
