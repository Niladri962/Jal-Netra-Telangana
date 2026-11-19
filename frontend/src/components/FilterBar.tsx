import { Filter, RotateCcw } from 'lucide-react';
import { useStore } from '../store';

export default function FilterBar({ showDays = true, showSeverity = true }: { showDays?: boolean; showSeverity?: boolean }) {
  const sim = useStore((s) => s.sim);
  const f = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const mandals = f.district ? sim.districts.find((d) => d.id === f.district)?.mandals ?? [] : [];
  const villages = sim.villageOrder.filter((v) => (!f.district || sim.villages[v].districtId === f.district) && (!f.mandal || sim.villages[v].mandal === f.mandal));
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-2 px-3 py-2">
      <Filter size={14} className="text-teal-400" aria-hidden />
      <select className="inp" aria-label="District" value={f.district} onChange={(e) => setFilters({ district: e.target.value, mandal: '', village: '' })}>
        <option value="">All 33 districts</option>
        {sim.districts.map((d) => (
          <option key={d.id} value={d.id}>{d.name}</option>
        ))}
      </select>
      <select className="inp" aria-label="Mandal" value={f.mandal} disabled={!f.district} onChange={(e) => setFilters({ mandal: e.target.value, village: '' })}>
        <option value="">All mandals</option>
        {mandals.map((m) => (
          <option key={m}>{m}</option>
        ))}
      </select>
      <select className="inp max-w-[170px]" aria-label="Village" value={f.village} onChange={(e) => setFilters({ village: e.target.value })}>
        <option value="">All villages ({villages.length})</option>
        {villages.map((v) => (
          <option key={v} value={v}>{sim.villages[v].name}</option>
        ))}
      </select>
      {showDays && (
        <select className="inp" aria-label="Date range" value={f.days} onChange={(e) => setFilters({ days: Number(e.target.value) })}>
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
        </select>
      )}
      {showSeverity && (
        <select className="inp" aria-label="Alert severity" value={f.severity} onChange={(e) => setFilters({ severity: e.target.value as typeof f.severity })}>
          <option value="all">All severities</option>
          <option value="warning">Warning + critical</option>
          <option value="critical">Critical only</option>
        </select>
      )}
      <button className="btn ml-auto" onClick={() => setFilters({ district: '', mandal: '', village: '', days: 30, severity: 'all' })}>
        <RotateCcw size={12} /> Clear
      </button>
    </div>
  );
}
