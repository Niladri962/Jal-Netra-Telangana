import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import FilterBar from '../components/FilterBar';
import MapView from '../components/MapView';
import { barCursor, Card, chartTooltip, fmtNum, Notice, PageHeader, SevBadge, Stat, STATUS } from '../components/ui';
import { round } from '../engine/rng';
import type { Severity } from '../engine/types';
import { useStore, villagesInFilter } from '../store';

const EXAMPLE = [
  { name: 'Village A', pop: 5000, mld: 0.4 },
  { name: 'Village B', pop: 8000, mld: 0.28 },
  { name: 'Village C', pop: 10000, mld: 0.2 },
  { name: 'Village D', pop: 4000, mld: 0.36 },
  { name: 'Village E', pop: 6000, mld: 0.18 },
];

export default function EquityPage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const filters = useStore((s) => s.filters);
  const th = useStore((s) => s.thresholds);
  const setPopulation = useStore((s) => s.setPopulation);
  const setSupplyMLD = useStore((s) => s.setSupplyMLD);
  const restoreVillage = useStore((s) => s.restoreVillage);
  const selectVillage = useStore((s) => s.selectVillage);
  const setMapLayer = useStore((s) => s.setMapLayer);
  const [example, setExample] = useState(EXAMPLE);

  useEffect(() => {
    setMapLayer('equity');
  }, [setMapLayer]);

  const vids = villagesInFilter({ sim, filters });
  const rows = vids.map((v) => ({ id: v, v: sim.villages[v], d: derived.villages[v] })).sort((a, b) => a.d.equityScore - b.d.equityScore);
  const underserved = rows.filter((r) => r.d.supplyStatus !== 'normal').reduce((a, r) => a + r.v.population, 0);
  const districts = Object.values(derived.districts).sort((a, b) => b.equityScore - a.equityScore);
  const priority = [...rows].sort((a, b) => b.d.gapKL * (1 + (100 - b.d.equityScore) / 100) - a.d.gapKL * (1 + (100 - a.d.equityScore) / 100)).slice(0, 10);

  const exRows = example.map((e) => {
    const lpcd = e.pop > 0 ? (e.mld * 1e6) / e.pop : 0;
    const pct = (lpcd / th.lpcdNorm) * 100;
    const s: Severity = pct < th.lpcdCritPct ? 'critical' : pct < th.lpcdWarnPct ? 'warning' : 'normal';
    return { ...e, lpcd: round(lpcd, 1), demand: round((e.pop * th.lpcdNorm) / 1e6, 3), gap: round(Math.max(0, (e.pop * th.lpcdNorm) / 1e6 - e.mld), 3), pct: round(Math.min(100, pct), 1), score: round(100 * Math.min(1, lpcd / th.lpcdNorm), 1), s };
  });
  const exRank = [...exRows].sort((a, b) => a.score - b.score);

  return (
    <div>
      <PageHeader title="Water Equity Intelligence" subtitle={`Are villages receiving adequate and equitable supply? LPCD vs the ${th.lpcdNorm} LPCD rural norm, demand fulfilled, reliability, supply days and quality combine into a 0–100 equity score. Edit population or supply to recalculate instantly.`} />
      <FilterBar showDays={false} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Villages in scope" value={rows.length} />
        <Stat label="Underserved population" value={fmtNum(underserved)} s={underserved ? 'warning' : 'normal'} />
        <Stat label="Severe shortage villages" value={rows.filter((r) => r.d.supplyStatus === 'critical').length} s="critical" />
        <Stat label="Moderate shortage villages" value={rows.filter((r) => r.d.supplyStatus === 'warning').length} s="warning" />
        <Stat label="State LPCD Gini" value={derived.kpi.gini} unit="(0 = equal)" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <Card title="Village equity table (editable)" bodyClass="max-h-[560px] overflow-auto">
          <table className="tbl">
            <thead>
              <tr><th>#</th><th>Village</th><th>Population</th><th>Supply (MLD)</th><th>LPCD</th><th>Gap kL/d</th><th>Fulfilled</th><th>Equity</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id}>
                  <td className="text-slate-500">{i + 1}</td>
                  <td className="whitespace-nowrap"><button className="hover:text-teal-300" onClick={() => selectVillage(r.id)}>{r.v.name}</button><div className="text-[10px] text-slate-500">{sim.districts.find((d) => d.id === r.v.districtId)?.name}</div></td>
                  <td><input aria-label={`Population of ${r.v.name}`} type="number" className="inp w-[84px] !py-0.5 font-mono" value={r.v.population} step={100} onChange={(e) => e.target.value !== '' && setPopulation(r.id, Number(e.target.value))} /></td>
                  <td><input aria-label={`Supply of ${r.v.name}`} type="number" className="inp w-[72px] !py-0.5 font-mono" value={round(r.d.supplyKL / 1000, 3)} step={0.01} onChange={(e) => e.target.value !== '' && setSupplyMLD(r.id, Number(e.target.value))} /></td>
                  <td className="font-mono" style={{ color: STATUS[r.d.supplyStatus] }}>{r.d.lpcd}</td>
                  <td className="font-mono">{r.d.gapKL}</td>
                  <td className="font-mono">{r.d.fulfilledPct}%</td>
                  <td><SevBadge s={r.d.equityStatus} label={String(r.d.equityScore)} /></td>
                  <td><button className="text-slate-500 hover:text-teal-300" onClick={() => restoreVillage(r.id)} aria-label="Restore"><RotateCcw size={12} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          <MapView height={330} />
          <Card title="Priority intervention ranking (largest gap × inequity)" bodyClass="p-2">
            {priority.map((r, i) => (
              <div key={r.id} className="flex items-center justify-between px-2 py-1 text-[12px]">
                <span><span className="mr-2 font-mono text-slate-500">{i + 1}</span>{r.v.name} <span className="text-slate-500">· {fmtNum(r.v.population)} people</span></span>
                <span className="font-mono">{r.d.gapKL} kL/d gap · {r.d.lpcd} LPCD</span>
              </div>
            ))}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card title="District equity ranking">
          <div className="h-[300px]">
            <ResponsiveContainer>
              <BarChart data={districts} layout="vertical" margin={{ top: 0, right: 16, left: 20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 9 }} width={120} interval={0} />
                <Tooltip {...chartTooltip} cursor={barCursor} formatter={(v: number, _n, p) => [`${v} (Gini ${p.payload?.gini}, ${p.payload?.avgLpcd} LPCD)`, 'Equity score']} />
                <Bar dataKey="equityScore" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                  {districts.map((d) => {
                    const pct = (d.avgLpcd / th.lpcdNorm) * 100;
                    return <Cell key={d.id} fill={STATUS[pct < th.lpcdCritPct ? 'critical' : pct < th.lpcdWarnPct ? 'warning' : 'normal']} />;
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="text-[10.5px] text-slate-500">Bar colour = district average LPCD status. Hover for the within-district Gini coefficient.</div>
        </Card>
        <Card title="Worked example — edit population & supply" right={<button className="btn !py-0.5" onClick={() => setExample(EXAMPLE)}><RotateCcw size={12} /> Reset</button>} bodyClass="p-3 space-y-3">
          <table className="tbl">
            <thead><tr><th>Village</th><th>Population</th><th>Supply (MLD)</th><th>LPCD</th><th>Gap (MLD)</th><th>Fulfilled</th><th>Category</th></tr></thead>
            <tbody>
              {exRows.map((e, i) => (
                <tr key={e.name}>
                  <td>{e.name}</td>
                  <td><input aria-label={`${e.name} population`} type="number" className="inp w-[80px] !py-0.5 font-mono" value={e.pop} step={100} onChange={(ev) => setExample(example.map((x, j) => (j === i ? { ...x, pop: Number(ev.target.value) } : x)))} /></td>
                  <td><input aria-label={`${e.name} supply`} type="number" className="inp w-[70px] !py-0.5 font-mono" value={e.mld} step={0.01} onChange={(ev) => setExample(example.map((x, j) => (j === i ? { ...x, mld: Number(ev.target.value) } : x)))} /></td>
                  <td className="font-mono" style={{ color: STATUS[e.s] }}>{e.lpcd}</td>
                  <td className="font-mono">{e.gap}</td>
                  <td className="font-mono">{e.pct}%</td>
                  <td><SevBadge s={e.s} label={e.s === 'critical' ? 'Severe shortage' : e.s === 'warning' ? 'Moderate' : 'Adequate'} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="text-[12px] text-slate-300">Priority ranking: {exRank.map((e, i) => `${i + 1}. ${e.name}`).join(' · ')}</div>
          <Notice>LPCD = supply (litres/day) ÷ population. Category thresholds: adequate ≥ {th.lpcdWarnPct}% of norm, moderate {th.lpcdCritPct}–{th.lpcdWarnPct}%, severe &lt; {th.lpcdCritPct}%. This sandbox is a teaching table; the main table above drives the live alerts.</Notice>
        </Card>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Supply alerts are raised automatically when a village drops below {th.lpcdWarnPct}% of the norm (see Alert Centre).</p>
    </div>
  );
}
