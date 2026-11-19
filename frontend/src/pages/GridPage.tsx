import { useState } from 'react';
import { Layers, Maximize2, Search, X } from 'lucide-react';
import MapView from '../components/MapView';
import VillagePanel from '../components/VillagePanel';
import { Card, fmtNum, Notice, PageHeader, SevBadge, Stat, Tabs } from '../components/ui';
import { LOSS_LABEL } from '../engine/compute';
import { useStore } from '../store';

export default function GridPage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const layers = useStore((s) => s.layers);
  const setLayers = useStore((s) => s.setLayers);
  const mapLayer = useStore((s) => s.mapLayer);
  const setMapLayer = useStore((s) => s.setMapLayer);
  const selectedVillageId = useStore((s) => s.selectedVillageId);
  const selectedDistrictId = useStore((s) => s.selectedDistrictId);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectVillage = useStore((s) => s.selectVillage);
  const selectDistrict = useStore((s) => s.selectDistrict);
  const selectSegment = useStore((s) => s.selectSegment);
  const filters = useStore((s) => s.filters);
  const setFilters = useStore((s) => s.setFilters);
  const setPage = useStore((s) => s.setPage);
  const featured = useStore((s) => s.plan.featuredVillageId);
  const basemap = useStore((s) => s.basemap);
  const setBasemap = useStore((s) => s.setBasemap);
  const [q, setQ] = useState('');
  const [fit, setFit] = useState(0);

  const matches = q.length >= 2
    ? [
        ...sim.districts.filter((d) => d.name.toLowerCase().includes(q.toLowerCase())).map((d) => ({ kind: 'district' as const, id: d.id, label: `${d.name} district` })),
        ...sim.villageOrder.filter((v) => sim.villages[v].name.toLowerCase().includes(q.toLowerCase()) || sim.villages[v].mandal.toLowerCase().includes(q.toLowerCase())).map((v) => ({ kind: 'village' as const, id: v, label: `${sim.villages[v].name} · ${sim.villages[v].mandal}` })),
      ].slice(0, 8)
    : [];

  const toggle = (k: keyof typeof layers, label: string) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-slate-300">
      <input type="checkbox" checked={layers[k]} onChange={(e) => setLayers({ [k]: e.target.checked })} className="accent-teal-500" />
      {label}
    </label>
  );

  const d = selectedDistrictId ? derived.districts[selectedDistrictId] : undefined;
  const seg = selectedSegmentId ? derived.segments[selectedSegmentId] : undefined;

  return (
    <div>
      <PageHeader
        title="Telangana Virtual Water Grid"
        subtitle="Interactive GIS twin: Water source → WTP → transmission main → district service reservoir → distribution main → village storage → end-point tap. Click a district hub, a village or a sensor node."
        right={
          <button className="btn btn-primary" onClick={() => selectVillage(featured)}>
            Open demo village ({sim.villages[featured].name})
          </button>
        }
      />
      <div className="card mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2 text-slate-500" aria-hidden />
          <input className="inp w-[220px] !pl-7" placeholder="Search villages, mandals, districts" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search map" />
          {matches.length > 0 && (
            <div className="absolute z-[900] mt-1 w-[260px] rounded-lg border border-navy-600 bg-navy-900 p-1 shadow-xl">
              {matches.map((m) => (
                <button
                  key={m.kind + m.id}
                  className="block w-full rounded px-2 py-1 text-left text-[12px] hover:bg-navy-700"
                  onClick={() => {
                    if (m.kind === 'district') {
                      selectDistrict(m.id);
                      setFilters({ district: m.id, mandal: '', village: '' });
                    } else selectVillage(m.id);
                    setQ('');
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Layers size={13} className="text-teal-400" aria-hidden />
          <span className="lbl">Village layer</span>
          <Tabs value={mapLayer} onChange={setMapLayer} items={[{ id: 'quality', label: 'Water quality' }, { id: 'supply', label: 'Water supply' }, { id: 'health', label: 'Public health risk' }, { id: 'equity', label: 'Water equity' }]} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {toggle('pipelines', 'Pipelines')}
          {toggle('flowAnimation', 'Animate flow')}
          {toggle('infrastructure', 'Infrastructure')}
          {toggle('nodes', 'Sensor nodes (zoom ≥ 11)')}
          {toggle('health', 'Health halos')}
        </div>
        <select className="inp" value={basemap} onChange={(e) => setBasemap(e.target.value as typeof basemap)} aria-label="Basemap">
          <option value="dark">Basemap: Dark (Esri)</option>
          <option value="streets">Basemap: Streets (OSM)</option>
          <option value="satellite">Basemap: Satellite (Esri)</option>
          <option value="none">Basemap: None (offline)</option>
        </select>
        <select className="inp" value={filters.district} onChange={(e) => setFilters({ district: e.target.value, mandal: '', village: '' })} aria-label="Filter district">
          <option value="">All districts</option>
          {sim.districts.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <select className="inp" value={filters.severity} onChange={(e) => setFilters({ severity: e.target.value as typeof filters.severity })} aria-label="Filter severity">
          <option value="all">All villages</option>
          <option value="warning">Warning + critical</option>
          <option value="critical">Critical only</option>
        </select>
        <button className="btn" onClick={() => { setFilters({ district: '', mandal: '', village: '' }); setFit((f) => f + 1); selectVillage(undefined); }}>
          <Maximize2 size={12} /> Fit Telangana
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_440px]">
        <MapView height="calc(100vh - 230px)" fitSignal={fit} onSegmentClick={(id) => selectSegment(id)} onDistrictClick={() => selectVillage(undefined)} />
        <div className="flex max-h-[calc(100vh-230px)] min-h-[400px] flex-col gap-3">
          {selectedVillageId ? (
            <VillagePanel villageId={selectedVillageId} onClose={() => selectVillage(undefined)} />
          ) : d ? (
            <Card title={<>{d.name} district <SevBadge s={d.qualityStatus} /></>} right={<button className="btn !px-1.5" onClick={() => selectDistrict(undefined)} aria-label="Close"><X size={14} /></button>} bodyClass="p-3 space-y-3 overflow-y-auto">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Population covered" value={fmtNum(d.population)} />
                <Stat label="Monitored villages" value={d.villages} />
                <Stat label="Total supply" value={d.supplyMLD} unit="MLD" />
                <Stat label="Average LPCD" value={d.avgLpcd} unit="LPCD" />
                <Stat label="Water quality" value={`${d.counts.critical} crit · ${d.counts.warning} warn`} s={d.qualityStatus} />
                <Stat label="Critical alerts" value={d.criticalAlerts} s={d.criticalAlerts ? 'critical' : 'normal'} />
                <Stat label="Pipeline integrity" value={`${d.lossPct}% loss`} s={d.pipelineStatus} />
                <Stat label="Equity score" value={d.equityScore} unit={`Gini ${d.gini}`} />
              </div>
              <div className="lbl">Villages</div>
              <div className="space-y-1">
                {sim.villageOrder.filter((v) => sim.villages[v].districtId === d.id).map((v) => (
                  <button key={v} onClick={() => selectVillage(v)} className="flex w-full items-center justify-between rounded-lg border border-navy-700 px-2.5 py-1.5 text-left text-[12px] hover:border-teal-500/50">
                    <span>{sim.villages[v].name} <span className="text-slate-500">· {sim.villages[v].mandal}</span></span>
                    <SevBadge s={derived.villages[v].status} />
                  </button>
                ))}
              </div>
              <Notice>District name & HQ position are real (approximate). Villages, sensors and network shown are simulated.</Notice>
            </Card>
          ) : (
            <Card title="How to use the grid" bodyClass="p-3 space-y-2 text-[12.5px] text-slate-300">
              <p>• Click a <b>district hub</b> (dashed ring) for district totals.</p>
              <p>• Click a <b>village marker</b> to open its sensor panel — drag any slider and watch the marker, pipelines, KPIs and alerts react.</p>
              <p>• Zoom in to level 11+ to see individual <b>sensor nodes</b> and in-village service lines.</p>
              <p>• Pipeline colours: green normal · amber reduced flow / uncertainty · red suspected leakage or disruption · grey unmonitored.</p>
              <Notice tone="warn">Reservoirs shown are real water bodies at approximate locations. Treatment plants, service reservoirs and every pipeline route are illustrative simulations — not verified Mission Bhagiratha infrastructure or alignments.</Notice>
              <button className="btn btn-primary" onClick={() => selectVillage(featured)}>Start the end-to-end demo with {sim.villages[featured].name}</button>
            </Card>
          )}
          {seg && (
            <Card title="Selected pipeline segment" right={<button className="btn !px-1.5" onClick={() => selectSegment(undefined)} aria-label="Close"><X size={14} /></button>} bodyClass="p-3 text-[12px] space-y-1">
              <div className="flex items-center gap-2"><SevBadge s={seg.severity} label={LOSS_LABEL[seg.classification]} /> <span className="text-slate-400">{seg.kind}</span></div>
              <div>Upstream {seg.upstream} {seg.unit} · downstream {seg.downstream} · authorised {seg.authorised}</div>
              <div>Loss {seg.loss} {seg.unit} (<b>{seg.lossPct}%</b>)</div>
              <div className="text-slate-400">{seg.note}</div>
              <button className="btn" onClick={() => setPage('pipeline')}>Open in Pipeline Integrity</button>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
