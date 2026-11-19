import { useState } from 'react';
import { BellRing, Check, Download, MessageSquareOff } from 'lucide-react';
import { Card, fmtTime, Notice, PageHeader, SevBadge, SevIcon, Stat } from '../components/ui';
import { DAY } from '../engine/generator';
import type { AlertCategory } from '../engine/types';
import { downloadCSV } from '../lib/export';
import { useStore } from '../store';

const CATS: AlertCategory[] = ['Water quality', 'Chemical safety', 'Water supply', 'Infrastructure', 'Water loss', 'Public health', 'Demand forecasting'];

export default function AlertsPage() {
  const sim = useStore((s) => s.sim);
  const alerts = useStore((s) => s.alerts);
  const ack = useStore((s) => s.ackAlert);
  const browserNotify = useStore((s) => s.browserNotify);
  const setBrowserNotify = useStore((s) => s.setBrowserNotify);
  const selectVillage = useStore((s) => s.selectVillage);
  const setPage = useStore((s) => s.setPage);
  const [f, setF] = useState({ status: 'active', severity: 'all', category: 'all', district: '', village: '', days: 30 });
  const [sel, setSel] = useState<string | null>(null);

  const list = alerts
    .filter((a) => (f.status === 'all' || a.status === f.status) && (f.severity === 'all' || a.severity === f.severity) && (f.category === 'all' || a.category === f.category) && (!f.district || a.districtId === f.district) && (!f.village || a.villageId === f.village) && a.updatedSim >= sim.simTime - f.days * DAY)
    .sort((a, b) => b.updatedSim - a.updatedSim || (a.severity === 'critical' ? -1 : 1));
  const a = alerts.find((x) => x.id === sel) ?? list[0];
  const active = alerts.filter((x) => x.status === 'active');

  const enableNotify = async () => {
    if (typeof Notification === 'undefined') return;
    const p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
    setBrowserNotify(p === 'granted');
  };
  const exportCSV = () =>
    downloadCSV('jalnetra_alert_history_SIMULATED.csv', list.map((x) => ({ id: x.id, status: x.status, severity: x.severity, category: x.category, title: x.title, district: sim.districts.find((d) => d.id === x.districtId)?.name, village: x.villageId ? sim.villages[x.villageId]?.name : '', node: x.nodeId ?? '', parameter: x.param ?? '', previous_value: x.prevValue ?? '', new_value: x.value, unit: x.unit, raised_sim: new Date(x.createdSim).toISOString(), resolved_sim: x.resolvedSim ? new Date(x.resolvedSim).toISOString() : '', delivery: x.delivery, simulated: true })));

  const sel_ = (k: keyof typeof f, opts: [string, string][], label: string) => (
    <select className="inp" aria-label={label} value={f[k]} onChange={(e) => setF({ ...f, [k]: k === 'days' ? Number(e.target.value) : e.target.value })}>
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );

  return (
    <div>
      <PageHeader title="Alert & Notification Centre" subtitle="Centralised, data-driven alerts. Each alert is generated from a live condition in the simulated data, records the previous and new values, and auto-resolves when the condition clears." right={<><button className="btn" onClick={exportCSV}><Download size={12} /> Export history</button><button className={`btn ${browserNotify ? 'btn-primary' : ''}`} onClick={browserNotify ? () => setBrowserNotify(false) : enableNotify}><BellRing size={12} /> Browser notifications {browserNotify ? 'on' : 'off'}</button></>} />
      <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Active" value={active.length} />
        <Stat label="Critical" value={active.filter((x) => x.severity === 'critical').length} s="critical" />
        <Stat label="Warning" value={active.filter((x) => x.severity === 'warning').length} s="warning" />
        <Stat label="Resolved (history)" value={alerts.filter((x) => x.status === 'resolved').length} s="normal" />
        {CATS.slice(0, 4).map((c) => <Stat key={c} label={c} value={active.filter((x) => x.category === c).length} />)}
      </div>
      <div className="card mb-3 flex flex-wrap items-center gap-2 px-3 py-2">
        {sel_('status', [['active', 'Active'], ['resolved', 'Resolved'], ['all', 'All statuses']], 'Status')}
        {sel_('severity', [['all', 'All severities'], ['critical', 'Critical'], ['warning', 'Warning']], 'Severity')}
        {sel_('category', [['all', 'All types'], ...CATS.map((c) => [c, c] as [string, string])], 'Type')}
        {sel_('district', [['', 'All districts'], ...sim.districts.map((d) => [d.id, d.name] as [string, string])], 'District')}
        {sel_('village', [['', 'All villages'], ...sim.villageOrder.filter((v) => !f.district || sim.villages[v].districtId === f.district).map((v) => [v, sim.villages[v].name] as [string, string])], 'Village')}
        {sel_('days', [['1', 'Last 24 h (sim)'], ['7', 'Last 7 days'], ['30', 'Last 30 days']], 'Date range')}
        <span className="ml-auto text-[11px] text-slate-500">{list.length} alerts</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Card bodyClass="max-h-[620px] overflow-auto">
          <table className="tbl">
            <thead><tr><th>Sev.</th><th>Alert</th><th>Type</th><th>Prev → New</th><th>Raised (sim)</th><th>Status</th></tr></thead>
            <tbody>
              {list.slice(0, 300).map((x) => (
                <tr key={x.id} onClick={() => setSel(x.id)} className={`cursor-pointer ${a?.id === x.id ? 'bg-teal-500/10' : ''}`}>
                  <td><SevIcon s={x.severity} /></td>
                  <td className="max-w-[280px] truncate">{x.title}</td>
                  <td className="whitespace-nowrap text-slate-400">{x.category}</td>
                  <td className="whitespace-nowrap font-mono">{x.prevValue ?? '—'} → {x.value} <span className="text-slate-500">{x.unit}</span></td>
                  <td className="whitespace-nowrap text-slate-400">{fmtTime(x.createdSim)}</td>
                  <td>{x.status === 'active' ? <SevBadge s={x.severity} label={x.acknowledged ? 'Ack’d' : 'Active'} /> : <span className="text-[11px] text-green-300">Resolved</span>}</td>
                </tr>
              ))}
              {!list.length && <tr><td colSpan={6} className="text-slate-500">No alerts match these filters.</td></tr>}
            </tbody>
          </table>
        </Card>
        <div className="space-y-4">
          {a && (
            <Card title={<><SevIcon s={a.severity} /> <span className="truncate">{a.title}</span></>} right={a.status === 'active' && !a.acknowledged && <button className="btn" onClick={() => ack(a.id)}><Check size={12} /> Acknowledge</button>} bodyClass="p-3 space-y-2 text-[12.5px]">
              <div className="flex flex-wrap gap-2"><SevBadge s={a.severity} /><span className="rounded border border-navy-600 px-1.5 text-[11px]">{a.category}</span><span className="text-[11px] font-semibold text-fuchsia-300">SIMULATED · {a.delivery}</span></div>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Village" value={a.villageId ? sim.villages[a.villageId].name : '—'} />
                <Stat label="District" value={sim.districts.find((d) => d.id === a.districtId)?.name ?? '—'} />
                <Stat label="Parameter" value={a.param ?? '—'} unit={a.nodeId ?? ''} />
                <Stat label="Previous → new" value={`${a.prevValue ?? '—'} → ${a.value}`} unit={a.unit} />
                <Stat label="Raised" value={fmtTime(a.createdSim)} unit={`wall ${new Date(a.createdWall).toLocaleTimeString('en-IN')}`} />
                <Stat label={a.status === 'resolved' ? 'Resolved' : 'Last update'} value={fmtTime(a.resolvedSim ?? a.updatedSim)} />
              </div>
              <p className="text-slate-300">{a.explanation}</p>
              <div className="lbl">Suggested corrective action</div>
              <ul className="ml-4 list-disc text-slate-300">{a.actions.map((x) => <li key={x}>{x}</li>)}</ul>
              <div className="lbl">Timeline</div>
              <div className="space-y-0.5">
                {a.history.map((h, i) => <div key={i} className="font-mono text-[11px] text-slate-400">{fmtTime(h.sim)} · {h.severity} · {h.value} · {h.note}</div>)}
              </div>
              {a.villageId && <button className="btn" onClick={() => { selectVillage(a.villageId, a.nodeId); setPage(a.category === 'Water loss' ? 'pipeline' : 'grid'); }}>Open on map</button>}
            </Card>
          )}
          <Card title={<><MessageSquareOff size={14} /> External messaging</>} bodyClass="p-3 space-y-2 text-[12px]">
            <div className="flex items-center justify-between"><span>SMS gateway</span><span className="rounded border border-navy-600 px-1.5 text-slate-500">Not configured</span></div>
            <div className="flex items-center justify-between"><span>WhatsApp Business API</span><span className="rounded border border-navy-600 px-1.5 text-slate-500">Not configured</span></div>
            <div className="flex items-center justify-between"><span>In-app & browser notifications</span><span className="rounded border border-teal-500/50 px-1.5 text-teal-300">Simulated</span></div>
            <Notice>All notifications are in-app simulations. No SMS or WhatsApp message is sent. External delivery should only be enabled after a real, authorised gateway integration is configured on the backend.</Notice>
          </Card>
        </div>
      </div>
    </div>
  );
}
