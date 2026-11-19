import { useState } from 'react';
import FilterBar from '../components/FilterBar';
import VillagePanel from '../components/VillagePanel';
import { Card, fmtTime, Notice, PageHeader, SevIcon, STATUS } from '../components/ui';
import { PARAM_INFO } from '../engine/thresholds';
import type { Param } from '../engine/types';
import { useStore, villagesInFilter } from '../store';

const COLS: Param[] = ['chlorine', 'turbidity', 'tds', 'ph', 'orp', 'flow', 'pressure'];

export default function Monitoring() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const filters = useStore((s) => s.filters);
  const changes = useStore((s) => s.changes);
  const selectedVillageId = useStore((s) => s.selectedVillageId);
  const selectVillage = useStore((s) => s.selectVillage);
  const featured = useStore((s) => s.plan.featuredVillageId);
  const [sort, setSort] = useState<'risk' | 'name'>('risk');

  const vids = villagesInFilter({ sim, filters }).filter((v) => filters.severity === 'all' || (filters.severity === 'warning' ? derived.villages[v].status !== 'normal' : derived.villages[v].status === 'critical'));
  const rows = [...vids].sort((a, b) => (sort === 'risk' ? derived.villages[b].qualityRisk - derived.villages[a].qualityRisk : sim.villages[a].name.localeCompare(sim.villages[b].name)));
  const active = selectedVillageId ?? featured;
  const faults = Object.values(sim.nodes).filter((n) => n.fault).length;

  return (
    <div>
      <PageHeader
        title="Live IoT Water Quality Monitoring"
        subtitle="Each village has its own sensor panel (2–3 nodes: storage-tank inlet, OHSR outlet on demo villages, end-point tap). Change any reading to trigger recalculation of status, risk score, map marker, alerts, charts and recommended actions."
      />
      <FilterBar showDays={false} />
      <div className="mb-3 grid gap-3 sm:grid-cols-4">
        <Card bodyClass="px-3 py-2"><div className="lbl">Nodes reporting</div><div className="font-mono text-lg text-white">{Object.keys(sim.nodes).length - faults} / {Object.keys(sim.nodes).length}</div></Card>
        <Card bodyClass="px-3 py-2"><div className="lbl">Sensor faults flagged</div><div className="font-mono text-lg text-amber-300">{faults}</div></Card>
        <Card bodyClass="px-3 py-2"><div className="lbl">Manually overridden nodes</div><div className="font-mono text-lg text-white">{Object.values(sim.nodes).filter((n) => Object.keys(n.overrides).length).length}</div></Card>
        <Card bodyClass="px-3 py-2"><div className="lbl">Telemetry interval</div><div className="font-mono text-lg text-white">15 min <span className="text-xs text-slate-500">(simulated)</span></div></Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_480px]">
        <div className="space-y-4">
          <Card title={`Village sensor table (${rows.length})`} right={<select className="inp !py-0.5" value={sort} onChange={(e) => setSort(e.target.value as 'risk')} aria-label="Sort"><option value="risk">Sort: highest risk</option><option value="name">Sort: name</option></select>} bodyClass="max-h-[620px] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Village</th>
                  <th>District</th>
                  <th>Risk</th>
                  {COLS.map((c) => <th key={c}>{PARAM_INFO[c].short}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((vid) => {
                  const vd = derived.villages[vid];
                  const n = sim.nodes[vd.worstNodeId];
                  const ne = derived.nodes[vd.worstNodeId];
                  return (
                    <tr key={vid} onClick={() => selectVillage(vid)} className={`cursor-pointer ${vid === active ? 'bg-teal-500/10' : ''}`}>
                      <td className="whitespace-nowrap"><span className="mr-1 inline-block align-middle"><SevIcon s={vd.status} size={12} /></span>{sim.villages[vid].name}{sim.villages[vid].demo && <span className="ml-1 text-[9px] text-teal-400">DEMO</span>}</td>
                      <td className="whitespace-nowrap text-slate-400">{sim.districts.find((d) => d.id === sim.villages[vid].districtId)?.name}</td>
                      <td className="font-mono">{vd.qualityRisk}</td>
                      {COLS.map((c) => (
                        <td key={c} className="font-mono" style={{ color: ne.params[c].severity === 'normal' ? undefined : STATUS[ne.params[c].severity] }}>
                          {n.current[c]}
                          {n.overrides[c] && <span className="text-amber-400">*</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
          <Card title="Parameter change log (this session)" bodyClass="max-h-[220px] overflow-auto">
            {changes.length === 0 && <div className="p-3 text-xs text-slate-500">No manual changes yet. Drag a slider in the sensor panel.</div>}
            <table className="tbl">
              <tbody>
                {[...changes].reverse().slice(0, 60).map((c) => (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap text-slate-500">{fmtTime(c.sim)}</td>
                    <td>{c.villageId ? sim.villages[c.villageId]?.name : '—'}</td>
                    <td className="font-mono text-slate-400">{c.nodeId ?? ''}</td>
                    <td>{c.param}</td>
                    <td className="font-mono">{c.oldValue} → {c.newValue}</td>
                    <td className="text-slate-500">{c.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Notice>Simulated sensor values are illustrative indicators and are not certified laboratory measurements. Thresholds are configurable under Data & Simulation Controls.</Notice>
        </div>
        <div className="xl:sticky xl:top-0 xl:max-h-[calc(100vh-120px)]">
          <VillagePanel villageId={active} />
        </div>
      </div>
    </div>
  );
}
