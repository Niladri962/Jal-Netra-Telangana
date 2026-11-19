import { FileDown, FileSpreadsheet, Lightbulb } from 'lucide-react';
import FilterBar from '../components/FilterBar';
import { Card, fmtNum, Notice, PageHeader, SevBadge, Stat } from '../components/ui';
import { LOSS_LABEL } from '../engine/compute';
import { round } from '../engine/rng';
import { downloadCSV, downloadPDF } from '../lib/export';
import { useStore, villagesInFilter } from '../store';

export default function ReportsPage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const alerts = useStore((s) => s.alerts);
  const filters = useStore((s) => s.filters);
  const fc = useStore((s) => s.forecast);
  const th = useStore((s) => s.thresholds);
  const selectVillage = useStore((s) => s.selectVillage);
  const setPage = useStore((s) => s.setPage);

  const vids = villagesInFilter({ sim, filters });
  const level = filters.village ? 'Village' : filters.mandal ? 'Mandal' : filters.district ? 'District' : 'State';
  const scopeName = filters.village ? sim.villages[filters.village].name : filters.mandal ? filters.mandal : filters.district ? sim.districts.find((d) => d.id === filters.district)!.name : 'Telangana (simulated network)';
  const vds = vids.map((v) => derived.villages[v]);
  const pop = vids.reduce((a, v) => a + sim.villages[v].population, 0);
  const supply = vds.reduce((a, v) => a + v.supplyKL, 0) / 1000;
  const demand = vds.reduce((a, v) => a + v.demandKL, 0) / 1000;
  const f30 = vds.reduce((a, v) => a + v.forecast.total30Demand, 0) / 1000;
  const c30 = vds.reduce((a, v) => a + v.forecast.total30Capacity, 0) / 1000;
  const scopeAlerts = alerts.filter((a) => a.status === 'active' && (!a.villageId ? !filters.district || a.districtId === filters.district : vids.includes(a.villageId)));
  const segs = sim.segments.filter((s) => (s.kind === 'distribution' && vids.includes(s.villageId!)) || (s.kind === 'transmission' && vids.some((v) => sim.villages[v].districtId === s.districtId)));
  const flagged = segs.filter((s) => derived.segments[s.id].severity !== 'normal');

  // Policy insights (state-wide)
  const all = Object.values(derived.villages);
  const underserved = [...all].sort((a, b) => a.fulfilledPct - b.fulfilledPct).slice(0, 5);
  const qualityDistricts = Object.values(derived.districts).sort((a, b) => b.qualityRiskAvg - a.qualityRiskAvg).slice(0, 5);
  const lossDistricts = Object.values(derived.districts).sort((a, b) => b.lossMLD - a.lossMLD).slice(0, 5);
  const invest = [...all].filter((v) => v.supplyStatus !== 'normal' || derived.segments[`seg-d-${v.id}`].severity !== 'normal').sort((a, b) => b.gapKL - a.gapKL).slice(0, 6);
  const inspect = [...all].sort((a, b) => b.qualityRisk + b.healthPriority - (a.qualityRisk + a.healthPriority)).slice(0, 6);
  const vn = (id: string) => `${sim.villages[id].name} (${sim.districts.find((d) => d.id === sim.villages[id].districtId)?.name})`;

  const villageRows = () =>
    vids.map((v) => {
      const d = derived.villages[v];
      const n = sim.nodes[d.worstNodeId].current;
      return {
        village_id: v, village: sim.villages[v].name, mandal: sim.villages[v].mandal, district: sim.districts.find((x) => x.id === sim.villages[v].districtId)?.name, population: sim.villages[v].population,
        status: d.status, quality_risk: d.qualityRisk, chlorine_mg_l: n.chlorine, turbidity_ntu: n.turbidity, tds_mg_l: n.tds, ph: n.ph, supply_kl_day: d.supplyKL, demand_kl_day: d.demandKL, lpcd: d.lpcd, fulfilled_pct: d.fulfilledPct,
        equity_score: d.equityScore, health_priority: d.healthPriority, forecast_7d_kl_day: d.forecast.avg7Demand, forecast_deficit_7d_pct: d.forecast.deficit7Pct, pipeline_loss_pct: derived.segments[`seg-d-${v}`].lossPct, pipeline_class: LOSS_LABEL[derived.segments[`seg-d-${v}`].classification], simulated: true,
      };
    });

  const exportPDF = () => {
    const rows = villageRows();
    downloadPDF(
      `jalnetra_${level.toLowerCase()}_report_${scopeName.replace(/\W+/g, '_')}.pdf`,
      `JalNetra ${level} Report — ${scopeName}`,
      `Generated ${new Date().toLocaleString('en-IN')} · simulation time ${new Date(sim.simTime).toLocaleString('en-IN')} · ${vids.length} villages`,
      [
        { heading: '1. Water quality summary', text: [`${vds.filter((v) => v.qualityStatus === 'normal').length} of ${vids.length} villages within thresholds; ${vds.filter((v) => v.qualityStatus === 'warning').length} warning, ${vds.filter((v) => v.qualityStatus === 'critical').length} critical. Average quality risk ${round(vds.reduce((a, v) => a + v.qualityRisk, 0) / Math.max(1, vds.length), 1)}/100.`], table: { head: ['Village', 'Status', 'Risk', 'FRC', 'Turb', 'TDS', 'pH'], body: rows.sort((a, b) => b.quality_risk - a.quality_risk).slice(0, 25).map((r) => [r.village, r.status, r.quality_risk, r.chlorine_mg_l, r.turbidity_ntu, r.tds_mg_l, r.ph]) } },
        { heading: '2. Water supply performance', text: [`Population ${fmtNum(pop)}; supply ${round(supply, 3)} MLD vs demand ${round(demand, 3)} MLD (${round((supply / Math.max(1e-9, demand)) * 100, 1)}% fulfilled); average ${round((supply * 1e6) / Math.max(1, pop), 1)} LPCD against ${th.lpcdNorm} LPCD norm.`] },
        { heading: '3. Water demand forecast (illustrative model)', text: [`Next 30 days: ${round(f30, 1)} ML demand vs ${round(c30, 1)} ML capacity → deficit ${round(Math.max(0, f30 - c30), 1)} ML. Scenario: ${fc.lpcd} LPCD, ${fc.temperatureC} °C, ${fc.rainfallMM} mm/day, population ${fc.populationChangePct}%, capacity ${fc.supplyCapacityPct}%.`] },
        { heading: '4. Water equity ranking', table: { head: ['Rank', 'Village', 'LPCD', 'Fulfilled %', 'Equity'], body: rows.sort((a, b) => a.equity_score - b.equity_score).slice(0, 15).map((r, i) => [i + 1, r.village, r.lpcd, r.fulfilled_pct, r.equity_score]) } },
        { heading: '5. Pipeline integrity status', text: [`${flagged.length} of ${segs.length} monitored segments flagged.`], table: flagged.length ? { head: ['Segment', 'Classification', 'Loss %'], body: flagged.map((s) => [s.kind === 'transmission' ? `${s.districtId} transmission` : sim.villages[s.villageId!].name, LOSS_LABEL[derived.segments[s.id].classification], derived.segments[s.id].lossPct]) } : undefined },
        { heading: '6. Public health risk alerts', text: ['Early-warning prioritisation only — not diagnosis or outbreak confirmation.'], table: { head: ['Village', 'Priority', 'Status', 'Case trend ×'], body: vds.filter((v) => v.healthStatus !== 'normal').map((v) => [sim.villages[v.id].name, v.healthPriority, v.healthStatus, v.caseTrendRatio]) } },
        { heading: '7. Recommended interventions', text: [...new Set(scopeAlerts.filter((a) => a.severity === 'critical').flatMap((a) => a.actions))].slice(0, 12).map((x) => `• ${x}`) },
      ],
    );
  };

  return (
    <div>
      <PageHeader title="Reports & Policy Insights" subtitle="Village, mandal, district and state reports compiled from the live simulated state. Choose a scope with the filters, then export CSV or PDF." right={<><button className="btn" onClick={() => downloadCSV(`jalnetra_${level.toLowerCase()}_${scopeName.replace(/\W+/g, '_')}.csv`, villageRows())}><FileSpreadsheet size={12} /> Export CSV</button><button className="btn btn-primary" onClick={exportPDF}><FileDown size={12} /> Export PDF</button></>} />
      <FilterBar showDays={false} showSeverity={false} />
      <Card title={`${level} report preview — ${scopeName}`} bodyClass="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
          <Stat label="Villages" value={vids.length} />
          <Stat label="Population" value={fmtNum(pop)} />
          <Stat label="Supply" value={round(supply, 3)} unit="MLD" />
          <Stat label="Demand" value={round(demand, 3)} unit="MLD" />
          <Stat label="Quality alerts" value={vds.filter((v) => v.qualityStatus !== 'normal').length} s={vds.some((v) => v.qualityStatus === 'critical') ? 'critical' : 'normal'} />
          <Stat label="30-d deficit" value={round(Math.max(0, f30 - c30), 1)} unit="ML" />
          <Stat label="Flagged segments" value={flagged.length} s={flagged.length ? 'warning' : 'normal'} />
          <Stat label="Health watch" value={vds.filter((v) => v.healthStatus !== 'normal').length} />
        </div>
        <div>
          <div className="lbl mb-1">Recommended interventions (from active critical alerts)</div>
          <ul className="ml-4 list-disc text-[12.5px] text-slate-300">
            {[...new Set(scopeAlerts.filter((a) => a.severity === 'critical').flatMap((a) => a.actions))].slice(0, 8).map((x) => <li key={x}>{x}</li>)}
            {!scopeAlerts.some((a) => a.severity === 'critical') && <li>No critical alerts in scope — continue routine monitoring.</li>}
          </ul>
        </div>
      </Card>

      <h2 className="mb-2 mt-6 flex items-center gap-2 text-base font-semibold text-white"><Lightbulb size={16} className="text-teal-400" /> Policy insights (state-wide, live)</h2>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Insight title="Most underserved villages" items={underserved.map((v) => ({ id: v.id, text: vn(v.id), val: `${v.lpcd} LPCD (${v.fulfilledPct}%)`, s: v.supplyStatus }))} onPick={(id) => { selectVillage(id); setPage('equity'); }} />
        <Insight title="Districts with highest quality risk" items={qualityDistricts.map((d) => ({ text: d.name, val: `avg risk ${d.qualityRiskAvg}`, s: d.qualityStatus }))} />
        <Insight title="Highest estimated water losses" items={lossDistricts.map((d) => ({ text: d.name, val: `${d.lossMLD} MLD (${d.lossPct}%)`, s: d.pipelineStatus }))} />
        <Insight title="Villages requiring infrastructure investment" items={invest.map((v) => ({ id: v.id, text: vn(v.id), val: `gap ${v.gapKL} kL/d`, s: v.supplyStatus }))} onPick={(id) => { selectVillage(id); setPage('pipeline'); }} />
        <Insight title="Priority locations for water-quality inspection" items={inspect.map((v) => ({ id: v.id, text: vn(v.id), val: `risk ${v.qualityRisk} · health ${v.healthPriority}`, s: v.qualityStatus }))} onPick={(id) => { selectVillage(id); setPage('grid'); }} />
        <Card title="Method note" bodyClass="p-3"><Notice>Insights are recomputed from the current simulated state each time the data changes. They illustrate how JalNetra would prioritise investment and inspection once connected to verified data — they are not findings about real Telangana villages.</Notice></Card>
      </div>
    </div>
  );
}

function Insight({ title, items, onPick }: { title: string; items: { id?: string; text: string; val: string; s: 'normal' | 'warning' | 'critical' }[]; onPick?: (id: string) => void }) {
  return (
    <Card title={title} bodyClass="p-2">
      {items.map((x, i) => (
        <button key={i} disabled={!x.id || !onPick} onClick={() => x.id && onPick?.(x.id)} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] enabled:hover:bg-navy-800">
          <span className="flex min-w-0 items-center gap-2"><span className="font-mono text-slate-500">{i + 1}</span><span className="truncate">{x.text}</span></span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-slate-300">{x.val} <SevBadge s={x.s} label=" " /></span>
        </button>
      ))}
    </Card>
  );
}
