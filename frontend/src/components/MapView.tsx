import { Fragment, useEffect, useMemo, useState } from 'react';
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngBoundsExpression } from 'leaflet';
import { TELANGANA_BOUNDS, TELANGANA_CENTER } from '../engine/geo';
import { LOSS_LABEL } from '../engine/compute';
import type { Severity } from '../engine/types';
import { useStore } from '../store';
import { STATUS } from './ui';

const TILES = {
  dark: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ', maxNativeZoom: 16 },
  streets: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', maxNativeZoom: 19 },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics', maxNativeZoom: 18 },
} as const;

const PIPE_COLOR = { green: '#22c55e', amber: '#f59e0b', red: '#ef4444', grey: '#64748b' } as const;

function ZoomWatcher({ onZoom }: { onZoom: (z: number) => void }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  return null;
}

function FlyTo({ target, zoom }: { target?: [number, number]; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), zoom), { duration: 0.8 });
  }, [target?.[0], target?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function FitTelangana({ fit, onMount }: { fit: number; onMount: boolean }) {
  const map = useMap();
  useEffect(() => {
    // Fit the whole state on first render (full-size maps) and whenever "Fit Telangana" is pressed.
    if (fit || onMount) map.fitBounds(TELANGANA_BOUNDS as LatLngBoundsExpression, { padding: [10, 10] });
  }, [fit]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export interface MapViewProps {
  height?: number | string;
  focusVillageId?: string;
  compact?: boolean;
  fitSignal?: number;
  onVillageClick?: (vid: string) => void;
  onDistrictClick?: (id: string) => void;
  onSegmentClick?: (id: string) => void;
}

export default function MapView({ height = 560, focusVillageId, compact = false, fitSignal = 0, onVillageClick, onDistrictClick, onSegmentClick }: MapViewProps) {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const layers = useStore((s) => s.layers);
  const mapLayer = useStore((s) => s.mapLayer);
  const filters = useStore((s) => s.filters);
  const selectedVillageId = useStore((s) => s.selectedVillageId);
  const selectedSegmentId = useStore((s) => s.selectedSegmentId);
  const selectVillage = useStore((s) => s.selectVillage);
  const selectDistrict = useStore((s) => s.selectDistrict);
  const th = useStore((s) => s.thresholds);
  const basemap = useStore((s) => s.basemap);
  const [zoom, setZoom] = useState(7);

  const focus = focusVillageId ?? selectedVillageId;
  const target = useMemo<[number, number] | undefined>(() => (focus ? [sim.villages[focus].lat, sim.villages[focus].lng] : undefined), [focus, sim.villages]);

  const villageStatus = (vid: string): Severity => {
    const v = derived.villages[vid];
    return mapLayer === 'quality' ? v.qualityStatus : mapLayer === 'supply' ? v.supplyStatus : mapLayer === 'health' ? v.healthStatus : v.equityStatus;
  };
  const districtStatus = (id: string): Severity => {
    const d = derived.districts[id];
    if (mapLayer === 'quality') return d.qualityStatus;
    if (mapLayer === 'supply' || mapLayer === 'equity') {
      const pct = (d.avgLpcd / th.lpcdNorm) * 100;
      return pct < th.lpcdCritPct ? 'critical' : pct < th.lpcdWarnPct ? 'warning' : 'normal';
    }
    return d.healthHigh > 0 ? (Object.values(derived.villages).some((v) => sim.villages[v.id].districtId === id && v.healthStatus === 'critical') ? 'critical' : 'warning') : 'normal';
  };

  const inFilter = (districtId: string, vid?: string) => {
    if (filters.district && districtId !== filters.district) return false;
    if (vid && filters.mandal && sim.villages[vid].mandal !== filters.mandal) return false;
    if (vid && filters.village && vid !== filters.village) return false;
    return true;
  };
  const sevOk = (s: Severity) => filters.severity === 'all' || (filters.severity === 'warning' ? s !== 'normal' : s === 'critical');

  const segs = sim.segments.filter((s) => inFilter(s.districtId, s.villageId) && (s.kind !== 'service' || zoom >= 10 || compact));

  return (
    <div className="relative overflow-hidden rounded-xl border border-navy-700" style={{ height }}>
      <MapContainer center={TELANGANA_CENTER} zoom={compact ? 11 : 7} minZoom={6} maxZoom={15} zoomControl={!compact} style={{ height: '100%', width: '100%' }} maxBounds={[[14.5, 75.5], [21, 83]]} preferCanvas={false}>
        {basemap !== 'none' && <TileLayer key={basemap} {...TILES[basemap]} />}
        <ZoomWatcher onZoom={setZoom} />
        <FlyTo target={target} zoom={compact ? 12 : 10} />
        <FitTelangana fit={fitSignal} onMount={!compact && !focus} />

        {/* Pipelines */}
        {layers.pipelines &&
          segs.map((seg) => {
            const sd = derived.segments[seg.id];
            const color = PIPE_COLOR[sd.color];
            const weight = seg.kind === 'transmission' ? 4 : seg.kind === 'intake' ? 4 : seg.kind === 'distribution' ? 2.4 : 1.6;
            const sel = selectedSegmentId === seg.id;
            return (
              <Polyline
                key={seg.id + sd.color}
                positions={seg.coords}
                pathOptions={{ color, weight: sel ? weight + 3 : weight, opacity: sd.color === 'grey' ? 0.55 : 0.85, dashArray: seg.kind === 'intake' ? '2 6' : undefined }}
                eventHandlers={{ click: () => onSegmentClick?.(seg.id) }}
              >
                <Tooltip sticky>
                  <div className="text-xs">
                    <div className="font-semibold">{seg.kind === 'transmission' ? 'Transmission main' : seg.kind === 'distribution' ? 'Distribution main' : seg.kind === 'intake' ? 'Raw-water intake' : 'Service line'} <span className="text-fuchsia-300">(illustrative)</span></div>
                    <div>{LOSS_LABEL[sd.classification]} {sd.kind !== 'intake' && sd.kind !== 'service' ? `· loss ${sd.lossPct}%` : ''}</div>
                    <div className="text-slate-400">up {sd.upstream} / down {sd.downstream} {sd.unit}</div>
                  </div>
                </Tooltip>
              </Polyline>
            );
          })}
        {layers.pipelines && layers.flowAnimation &&
          segs
            .filter((s) => s.kind !== 'intake' && derived.segments[s.id].color !== 'grey')
            .map((seg) => {
              const sd = derived.segments[seg.id];
              return <Polyline key={'f' + seg.id + sd.color} positions={seg.coords} interactive={false} pathOptions={{ color: sd.color === 'red' ? '#fecaca' : '#bae6fd', weight: seg.kind === 'transmission' ? 1.6 : 1.1, opacity: 0.75, className: sd.color === 'green' ? 'flow-anim' : 'flow-anim-slow' }} />;
            })}

        {/* Infrastructure */}
        {layers.infrastructure &&
          sim.sources.map((s) => (
            <CircleMarker key={s.id} center={[s.lat, s.lng]} radius={8} pathOptions={{ color: '#e0f2fe', weight: 1.5, fillColor: '#1e88e5', fillOpacity: 0.95 }}>
              <Tooltip>
                <div className="text-xs"><b>{s.name}</b> · {s.river}<br /><span className="text-sky-300">Real water body (approx. location)</span><br /><span className="text-fuchsia-300">Its role in this network is illustrative</span></div>
              </Tooltip>
            </CircleMarker>
          ))}
        {layers.infrastructure &&
          sim.wtps.map((w) => (
            <CircleMarker key={w.id} center={[w.lat, w.lng]} radius={6} pathOptions={{ color: '#ccfbf1', weight: 1.5, fillColor: '#14b8a6', fillOpacity: 0.95 }}>
              <Tooltip><div className="text-xs"><b>{w.name}</b><br />Capacity {w.capacityMLD.toFixed(2)} MLD (demo network)<br /><span className="text-fuchsia-300">Simulated treatment plant</span></div></Tooltip>
            </CircleMarker>
          ))}
        {layers.infrastructure &&
          sim.reservoirs.filter((m) => inFilter(m.districtId)).map((m) => (
            <CircleMarker key={m.id} center={[m.lat, m.lng]} radius={4.5} pathOptions={{ color: '#ede9fe', weight: 1, fillColor: '#9085e9', fillOpacity: 0.95 }}>
              <Tooltip><div className="text-xs"><b>District service reservoir</b> · {sim.districts.find((d) => d.id === m.districtId)?.name}<br /><span className="text-fuchsia-300">Simulated</span></div></Tooltip>
            </CircleMarker>
          ))}

        {/* District hubs */}
        {!compact &&
          sim.districts.filter((d) => inFilter(d.id)).map((d) => {
            const s = districtStatus(d.id);
            const dd = derived.districts[d.id];
            return (
              <CircleMarker
                key={d.id + s}
                center={[d.lat, d.lng]}
                radius={zoom >= 9 ? 16 : 11}
                pathOptions={{ color: STATUS[s], weight: 2, fillColor: STATUS[s], fillOpacity: 0.12, dashArray: '3 3' }}
                eventHandlers={{ click: () => { selectDistrict(d.id); onDistrictClick?.(d.id); } }}
              >
                <Tooltip direction="top" permanent={zoom >= 8} className="!px-1.5 !py-0.5">
                  <span className="text-[11px] font-semibold">{d.name}</span>
                  {zoom < 8 && <div className="text-[11px] text-slate-400">{dd.villages} villages · {dd.avgLpcd} LPCD · {dd.criticalAlerts} critical</div>}
                </Tooltip>
              </CircleMarker>
            );
          })}

        {/* Public-health halos */}
        {layers.health &&
          sim.villageOrder.filter((vid) => inFilter(sim.villages[vid].districtId, vid) && derived.villages[vid].healthPriority > 25).map((vid) => {
            const v = sim.villages[vid];
            const vd = derived.villages[vid];
            return <CircleMarker key={'h' + vid} center={[v.lat, v.lng]} radius={6 + vd.healthPriority / 5} interactive={false} pathOptions={{ stroke: false, fillColor: STATUS[vd.healthStatus === 'normal' ? 'warning' : vd.healthStatus], fillOpacity: 0.16 }} />;
          })}

        {/* Villages */}
        {sim.villageOrder
          .filter((vid) => inFilter(sim.villages[vid].districtId, vid) && sevOk(derived.villages[vid].status))
          .map((vid) => {
            const v = sim.villages[vid];
            const vd = derived.villages[vid];
            const s = villageStatus(vid);
            const sel = vid === focus;
            return (
              <Fragment key={vid}>
                {s === 'critical' && <CircleMarker center={[v.lat, v.lng]} radius={9} interactive={false} pathOptions={{ color: STATUS.critical, weight: 2, fill: false, className: 'pulse-crit' }} />}
                <CircleMarker
                  key={vid + s + (sel ? 's' : '')}
                  center={[v.lat, v.lng]}
                  radius={sel ? 9 : v.demo ? 6.5 : 5}
                  pathOptions={{ color: sel ? '#ffffff' : '#0a1630', weight: sel ? 3 : 1.5, fillColor: STATUS[s], fillOpacity: 0.95 }}
                  eventHandlers={{ click: () => { selectVillage(vid); onVillageClick?.(vid); } }}
                >
                  <Tooltip direction="top" offset={[0, -6]}>
                    <div className="text-xs">
                      <div className="font-semibold">{v.name} <span className="text-fuchsia-300">SIM</span></div>
                      <div className="text-slate-400">{v.mandal} · {sim.districts.find((d) => d.id === v.districtId)?.name}</div>
                      <div>Quality risk {vd.qualityRisk} · {vd.lpcd} LPCD · equity {vd.equityScore}</div>
                      <div>Health priority {vd.healthPriority}</div>
                    </div>
                  </Tooltip>
                </CircleMarker>
              </Fragment>
            );
          })}

        {/* Sensor nodes (zoomed in) */}
        {layers.nodes && (zoom >= 11 || compact) &&
          Object.values(sim.nodes)
            .filter((n) => inFilter(sim.villages[n.villageId].districtId, n.villageId) && n.kind !== 'inlet')
            .map((n) => {
              const ne = derived.nodes[n.id];
              return (
                <CircleMarker key={n.id + ne.status} center={[n.lat, n.lng]} radius={4} pathOptions={{ color: '#e2e8f0', weight: 1, fillColor: n.fault ? STATUS.idle : STATUS[ne.status], fillOpacity: 1 }} eventHandlers={{ click: () => selectVillage(n.villageId, n.id) }}>
                  <Tooltip><div className="text-xs"><b>{n.label}</b> · {n.id}<br />FRC {n.current.chlorine} · Turb {n.current.turbidity} · Flow {n.current.flow}{n.fault ? <><br /><span className="text-slate-400">Sensor fault</span></> : null}</div></Tooltip>
                </CircleMarker>
              );
            })}
      </MapContainer>

      {!compact && (
        <div className="pointer-events-none absolute bottom-2 left-2 z-[500] max-w-[260px] rounded-lg border border-navy-700 bg-navy-950/90 p-2 text-[10.5px] leading-snug text-slate-300">
          <div className="mb-1 font-semibold text-slate-200">Legend</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATUS.normal }} />Normal</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATUS.warning }} />Warning</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATUS.critical }} />Critical</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: STATUS.idle }} />Inactive / unmonitored</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#1e88e5]" />Reservoir (real)</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-teal-500" />WTP (sim)</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#9085e9]" />Service reservoir (sim)</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full border border-dashed border-slate-300" />District HQ</span>
          </div>
          <div className="mt-1 text-fuchsia-300/90">Pipelines are illustrative schematic links — not actual Mission Bhagiratha alignments.</div>
        </div>
      )}
    </div>
  );
}
