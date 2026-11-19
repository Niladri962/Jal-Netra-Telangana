import { RotateCcw } from 'lucide-react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import FilterBar from '../components/FilterBar';
import { barCursor, Card, chartTooltip, fmtNum, Notice, PageHeader, SERIES, SevBadge, Stat, STATUS } from '../components/ui';
import { CLIMATE } from '../engine/geo';
import { defaultForecastSettings } from '../engine/forecast';
import { DAY } from '../engine/generator';
import { round } from '../engine/rng';
import { useStore, villagesInFilter } from '../store';

export default function ForecastPage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const filters = useStore((s) => s.filters);
  const fc = useStore((s) => s.forecast);
  const th = useStore((s) => s.thresholds);
  const setForecast = useStore((s) => s.setForecast);
  const selectVillage = useStore((s) => s.selectVillage);
  const setPage = useStore((s) => s.setPage);

  const vids = villagesInFilter({ sim, filters });
  const vds = vids.map((v) => derived.villages[v]);
  const scope = filters.village ? sim.villages[filters.village].name : filters.mandal ? `${filters.mandal} mandal` : filters.district ? `${sim.districts.find((d) => d.id === filters.district)?.name} district` : 'All Telangana (simulated villages)';

  // Actual (history) vs model fit (in-sample) vs forecast
  const hist = sim.supplyHistory[sim.villageOrder[0]];
  const series: Record<string, number | string | null | [number, number]>[] = hist.map((h, i) => {
    let actual = 0;
    let fitted = 0;
    let supplied = 0;
    for (const v of vids) {
      const d = sim.supplyHistory[v][i];
      const vv = sim.villages[v];
      const c = derived.villages[v].forecast.coef;
      actual += d.demandKL;
      supplied += d.suppliedKL;
      fitted += (vv.basePopulation * (c[0] + c[1] * (d.tempC - 30) + c[2] * Math.min(d.rainMM, 30) + c[3] * (new Date(d.day).getDay() === 0 ? 1 : 0))) / 1000 + vv.institutionalKL;
    }
    return { day: h.day.slice(5), actual: round(actual / 1000, 3), fitted: round(fitted / 1000, 3), supplied: round(supplied / 1000, 3), forecast: null, band: null, capacity: null };
  });
  const cap = vds.reduce((a, v) => a + v.forecast.avg7Capacity, 0) / 1000;
  for (let k = 0; k < 30; k++) {
    const dem = vds.reduce((a, v) => a + v.forecast.daily30[k].demand, 0) / 1000;
    const band = vds.reduce((a, v) => a + v.forecast.daily30[k].band, 0) / 1000;
    series.push({ day: new Date(sim.simTime + (k + 1) * DAY).toISOString().slice(5, 10), actual: null, fitted: null, supplied: null, forecast: round(dem, 3), band: [round(dem - band, 3), round(dem + band, 3)], capacity: round(cap, 3) });
  }

  const d7 = vds.reduce((a, v) => a + v.forecast.avg7Demand, 0) / 1000;
  const d30 = vds.reduce((a, v) => a + v.forecast.total30Demand, 0) / 1000;
  const c30 = vds.reduce((a, v) => a + v.forecast.total30Capacity, 0) / 1000;
  const deficit30 = Math.max(0, d30 - c30);
  const mape = vds.reduce((a, v) => a + v.forecast.mape, 0) / Math.max(1, vds.length);
  const shortage = vds.filter((v) => v.forecast.deficit7Pct > th.forecastDeficitPct).sort((a, b) => b.forecast.deficit7Pct - a.forecast.deficit7Pct);
  const monthly = vds[0]
    ? vds[0].forecast.monthly.map((m, i) => ({ month: m.month, Demand: round(vds.reduce((a, v) => a + v.forecast.monthly[i].demand, 0) / 1000, 1), Capacity: round(vds.reduce((a, v) => a + v.forecast.monthly[i].capacity, 0) / 1000, 1) }))
    : [];

  const slider = (label: string, key: keyof typeof fc, min: number, max: number, step: number, unit: string) => (
    <div>
      <div className="flex items-center justify-between text-[12px]">
        <label htmlFor={`fc-${key}`} className="text-slate-300">{label}</label>
        <span className="font-mono text-white">{fc[key]} {unit}</span>
      </div>
      <input id={`fc-${key}`} type="range" min={min} max={max} step={step} value={fc[key]} onChange={(e) => setForecast({ [key]: Number(e.target.value) })} className="w-full" />
    </div>
  );

  return (
    <div>
      <PageHeader title="AI Water Demand Forecasting" subtitle={`Village → mandal → district → state demand projections. Scope: ${scope}. Change any input and every forecast, deficit and shortage alert recalculates.`} />
      <FilterBar showDays={false} showSeverity={false} />
      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card title="Scenario inputs" right={<button className="btn !py-0.5" onClick={() => setForecast(defaultForecastSettings(sim.simTime))}><RotateCcw size={12} /> Reset</button>} bodyClass="p-3 space-y-3">
            {slider('Population change', 'populationChangePct', -20, 50, 1, '%')}
            {slider('Per-capita requirement', 'lpcd', 40, 160, 5, 'LPCD')}
            {slider('Expected rainfall', 'rainfallMM', 0, 30, 0.5, 'mm/day')}
            {slider('Expected max temperature', 'temperatureC', 20, 46, 0.5, '°C')}
            {slider('Supply capacity', 'supplyCapacityPct', 40, 160, 5, '% of current')}
            <div className="text-[11px] text-slate-500">
              Climatology for {new Date(sim.simTime).toLocaleString('en-IN', { month: 'long' })}: {CLIMATE[new Date(sim.simTime).getMonth()][0]} °C, {CLIMATE[new Date(sim.simTime).getMonth()][1]} mm/day. Scenario inputs apply to all villages; the scope filter selects which aggregate is shown. Annual population growth and seasonality are included automatically.
            </div>
          </Card>
          <Card title="Model card" bodyClass="p-3 text-[12px] space-y-1.5 text-slate-300">
            <div><b>Type:</b> per-village OLS (ridge λ=0.5) on 30-day synthetic history</div>
            <div><b>Features:</b> temperature deviation, rainfall, Sunday flag, + seasonality, growth, LPCD scaling</div>
            <div><b>Backtest MAPE</b> (train 20 d / test 10 d): <span className="font-mono text-white">{round(mape, 2)}%</span></div>
            {filters.village && <div><b>Coefficients</b> (L/person/day): <span className="font-mono">{derived.villages[filters.village].forecast.coef.join(', ')}</span></div>}
            <Notice tone="warn">Illustrative model trained on synthetic data. It is not a validated production forecasting model and should not be used for operational planning without calibration on real metered data.</Notice>
          </Card>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Next 7-day avg demand" value={fmtNum(d7, 2)} unit="MLD" />
            <Stat label="Next 30-day demand" value={fmtNum(d30, 1)} unit="ML" />
            <Stat label="30-day capacity" value={fmtNum(c30, 1)} unit="ML" />
            <Stat label="Expected deficit (30 d)" value={fmtNum(deficit30, 1)} unit="ML" s={deficit30 > 0 ? 'warning' : 'normal'} />
            <Stat label="Additional supply needed" value={fmtNum(deficit30 / 30, 3)} unit="MLD" s={deficit30 > 0 ? 'warning' : 'normal'} />
          </div>
          <Card title="Actual vs model vs 30-day forecast (MLD)">
            <div className="h-[300px]">
              <ResponsiveContainer>
                <ComposedChart data={series} margin={{ top: 6, right: 12, left: -6, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} minTickGap={18} />
                  <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                  <Tooltip {...chartTooltip} formatter={(v: number | number[], n: string) => [Array.isArray(v) ? `${v[0]} – ${v[1]}` : v, n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area dataKey="band" name="95% band" stroke="none" fill={SERIES[2]} fillOpacity={0.18} isAnimationActive={false} />
                  <Line dataKey="actual" name="Actual demand (est.)" stroke={SERIES[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="fitted" name="Model fit" stroke={SERIES[1]} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
                  <Line dataKey="supplied" name="Supplied" stroke="#94a3b8" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                  <Line dataKey="forecast" name="Forecast" stroke={SERIES[2]} strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line dataKey="capacity" name="Supply capacity" stroke={STATUS.warning} strokeWidth={1.5} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Monthly demand forecast vs capacity (ML)">
              <div className="h-[220px]">
                <ResponsiveContainer>
                  <BarChart data={monthly} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip {...chartTooltip} cursor={barCursor} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="Demand" fill={SERIES[2]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="Capacity" fill={SERIES[0]} radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title={`Villages likely to face shortage (> ${th.forecastDeficitPct}% deficit, next 7 days): ${shortage.length}`} bodyClass="max-h-[250px] overflow-auto">
              <table className="tbl">
                <thead><tr><th>Village</th><th>Demand kL/d</th><th>Capacity</th><th>Deficit</th><th>Status</th></tr></thead>
                <tbody>
                  {shortage.slice(0, 40).map((v) => (
                    <tr key={v.id} className="cursor-pointer" onClick={() => { selectVillage(v.id); setPage('grid'); }}>
                      <td>{sim.villages[v.id].name}</td>
                      <td className="font-mono">{v.forecast.avg7Demand}</td>
                      <td className="font-mono">{v.forecast.avg7Capacity}</td>
                      <td className="font-mono">{v.forecast.deficit7Pct}%</td>
                      <td><SevBadge s={v.forecast.deficit7Pct > th.forecastDeficitPct * 1.75 ? 'critical' : 'warning'} /></td>
                    </tr>
                  ))}
                  {!shortage.length && <tr><td colSpan={5} className="text-slate-500">No villages exceed the shortage threshold under this scenario.</td></tr>}
                </tbody>
              </table>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
