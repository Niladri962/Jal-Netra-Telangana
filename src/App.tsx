import { useEffect, useState } from 'react';
import {
  Activity, BarChart3, Bell, Bot, Database, Droplets, FileText, FlaskConical, Gauge, HeartPulse, LayoutDashboard, Map as MapIcon, Menu, Pause, Play, Scale, Waypoints, X,
} from 'lucide-react';
import { useStore, type Page } from './store';
import { probeBackend } from './lib/backend';
import { fmtTime, SevIcon } from './components/ui';
import CommandCentre from './pages/CommandCentre';
import GridPage from './pages/GridPage';
import Monitoring from './pages/Monitoring';
import ForecastPage from './pages/ForecastPage';
import PipelinePage from './pages/PipelinePage';
import HealthPage from './pages/HealthPage';
import EquityPage from './pages/EquityPage';
import AssistantPage from './pages/AssistantPage';
import LabPage from './pages/LabPage';
import ReportsPage from './pages/ReportsPage';
import AlertsPage from './pages/AlertsPage';
import DataPage from './pages/DataPage';

const NAV: { id: Page; label: string; icon: typeof Gauge }[] = [
  { id: 'command', label: 'Executive Command Centre', icon: LayoutDashboard },
  { id: 'grid', label: 'Telangana Virtual Water Grid', icon: MapIcon },
  { id: 'monitoring', label: 'Live Water Quality Monitoring', icon: Activity },
  { id: 'forecast', label: 'AI Water Demand Forecasting', icon: BarChart3 },
  { id: 'pipeline', label: 'Pipeline Integrity & Leakage', icon: Waypoints },
  { id: 'health', label: 'Waterborne Disease Early Warning', icon: HeartPulse },
  { id: 'equity', label: 'Water Equity Intelligence', icon: Scale },
  { id: 'assistant', label: 'JalNetra AI Assistant', icon: Bot },
  { id: 'lab', label: 'Water Quality Training Simulator', icon: FlaskConical },
  { id: 'reports', label: 'Reports & Policy Insights', icon: FileText },
  { id: 'alerts', label: 'Alert & Notification Centre', icon: Bell },
  { id: 'data', label: 'Data & Simulation Controls', icon: Database },
];

const PAGES: Record<Page, () => JSX.Element> = {
  command: CommandCentre,
  grid: GridPage,
  monitoring: Monitoring,
  forecast: ForecastPage,
  pipeline: PipelinePage,
  health: HealthPage,
  equity: EquityPage,
  assistant: AssistantPage,
  lab: LabPage,
  reports: ReportsPage,
  alerts: AlertsPage,
  data: DataPage,
};

export default function App() {
  const page = useStore((s) => s.page);
  const setPage = useStore((s) => s.setPage);
  const running = useStore((s) => s.running);
  const speed = useStore((s) => s.speed);
  const tick = useStore((s) => s.tick);
  const [navOpen, setNavOpen] = useState(false);

  // Hash routing
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash.replace('#', '') as Page;
      if (h && h in PAGES && h !== useStore.getState().page) useStore.setState({ page: h });
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    return () => window.removeEventListener('hashchange', fromHash);
  }, []);

  // Simulation clock: one tick (15 simulated minutes × speed) every 3 seconds.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => tick(), 3000);
    return () => clearInterval(id);
  }, [running, speed, tick]);

  // Optional backend detection
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const h = await probeBackend();
      if (!alive) return;
      useStore.getState().setBackend(h ? { online: true, llm: h.llm, model: h.model, ingest: h.ingest } : { online: false, llm: false, ingest: false });
    };
    check();
    const id = setInterval(check, 30000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const Current = PAGES[page];
  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-[1100] w-64 shrink-0 border-r border-navy-800 bg-navy-950 transition-transform lg:static lg:translate-x-0 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center gap-2.5 border-b border-navy-800 px-4 py-4">
          <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-water-500 to-teal-500 shadow-lg shadow-teal-500/20">
            <Droplets size={20} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-[15px] font-extrabold tracking-tight text-white">JalNetra</div>
            <div className="truncate text-[10.5px] text-slate-400">Telangana Virtual Water Grid</div>
          </div>
          <button className="ml-auto lg:hidden" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={18} />
          </button>
        </div>
        <nav className="space-y-0.5 overflow-y-auto p-2" style={{ maxHeight: 'calc(100% - 150px)' }}>
          {NAV.map((n, i) => (
            <button
              key={n.id}
              onClick={() => {
                setPage(n.id);
                setNavOpen(false);
              }}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[12.5px] transition ${page === n.id ? 'bg-teal-500/15 font-semibold text-teal-200' : 'text-slate-400 hover:bg-navy-800 hover:text-slate-200'}`}
            >
              <n.icon size={15} className="shrink-0" />
              <span className="truncate">{i < 10 ? `${i + 1}. ` : ''}{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-navy-800 p-3 text-[10.5px] leading-snug text-slate-500">
          <span className="font-semibold text-fuchsia-300">Simulation environment.</span> All readings, alerts and health data are synthetic. Not Mission Bhagiratha or government data.
        </div>
      </aside>
      {navOpen && <div className="fixed inset-0 z-[1050] bg-black/50 lg:hidden" onClick={() => setNavOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onMenu={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-4 lg:px-6">
          <Current />
          <footer className="mt-8 border-t border-navy-800 pt-3 text-center text-[11px] text-slate-500">
            “From Infrastructure Creation to Intelligent Water Governance — Every Drop Monitored, Every Village Accounted For.” · JalNetra prototype · synthetic data
          </footer>
        </main>
      </div>
      <Toasts />
    </div>
  );
}

function TopBar({ onMenu }: { onMenu: () => void }) {
  const simTime = useStore((s) => s.sim.simTime);
  const running = useStore((s) => s.running);
  const speed = useStore((s) => s.speed);
  const setRunning = useStore((s) => s.setRunning);
  const setSpeed = useStore((s) => s.setSpeed);
  const alerts = useStore((s) => s.alerts);
  const backend = useStore((s) => s.backend);
  const setPage = useStore((s) => s.setPage);
  const crit = alerts.filter((a) => a.status === 'active' && a.severity === 'critical').length;
  const warn = alerts.filter((a) => a.status === 'active' && a.severity === 'warning').length;
  return (
    <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-navy-800 bg-navy-950/80 px-4 py-2 backdrop-blur lg:px-6">
      <button className="lg:hidden" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <div className="flex items-center gap-2 rounded-lg border border-fuchsia-400/30 bg-fuchsia-500/5 px-2 py-1 text-[11px] font-semibold text-fuchsia-200">
        <FlaskConical size={12} /> SIMULATED DATA
      </div>
      <div className="flex items-center gap-2 font-mono text-[12px] text-slate-300">
        <span className={`h-2 w-2 rounded-full ${running ? 'animate-pulse bg-teal-400' : 'bg-slate-500'}`} />
        Sim clock {fmtTime(simTime)}
      </div>
      <div className="flex items-center gap-1">
        <button className="btn !py-1" onClick={() => setRunning(!running)} aria-label={running ? 'Pause simulation' : 'Resume simulation'}>
          {running ? <Pause size={12} /> : <Play size={12} />} {running ? 'Pause' : 'Resume'}
        </button>
        <select className="inp !py-1" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Simulation speed">
          <option value={1}>1× (15 min / 3 s)</option>
          <option value={2}>2×</option>
          <option value={4}>4× (1 h / 3 s)</option>
          <option value={8}>8×</option>
          <option value={16}>16×</option>
        </select>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span className={`hidden rounded-md border px-2 py-0.5 text-[10.5px] sm:inline ${backend.online ? 'border-teal-500/40 text-teal-300' : 'border-navy-600 text-slate-500'}`} title="Optional FastAPI backend">
          API {backend.online ? (backend.llm ? `online · LLM ${backend.model ?? ''}` : 'online · LLM not configured') : 'offline · browser engine'}
        </span>
        <button onClick={() => setPage('alerts')} className="flex items-center gap-2 rounded-lg border border-navy-700 px-2 py-1 text-[12px] hover:border-teal-500/50">
          <Bell size={14} />
          <span className="flex items-center gap-1 text-red-300"><SevIcon s="critical" size={12} />{crit}</span>
          <span className="flex items-center gap-1 text-amber-300"><SevIcon s="warning" size={12} />{warn}</span>
        </button>
      </div>
    </header>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  const selectVillage = useStore((s) => s.selectVillage);
  const setPage = useStore((s) => s.setPage);
  useEffect(() => {
    if (!toasts.length) return;
    const id = setTimeout(() => dismiss(toasts[0].id), 7000);
    return () => clearTimeout(id);
  }, [toasts, dismiss]);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1200] flex w-[340px] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto rounded-xl border bg-navy-900/95 p-3 shadow-2xl backdrop-blur ${t.severity === 'critical' ? 'border-red-500/60' : t.severity === 'warning' ? 'border-amber-500/50' : t.severity === 'resolved' ? 'border-green-500/50' : 'border-water-500/40'}`}>
          <div className="flex items-start gap-2">
            <div className="mt-0.5">{t.severity === 'resolved' ? <SevIcon s="normal" /> : t.severity === 'info' ? <Bell size={14} /> : <SevIcon s={t.severity} />}</div>
            <button
              className="min-w-0 flex-1 text-left"
              onClick={() => {
                if (t.villageId) {
                  selectVillage(t.villageId);
                  setPage('grid');
                }
                dismiss(t.id);
              }}
            >
              <div className="text-[12.5px] font-semibold text-white">{t.title}</div>
              <div className="mt-0.5 line-clamp-2 text-[11.5px] text-slate-400">{t.body}</div>
              <div className="mt-1 text-[10px] font-semibold tracking-wide text-fuchsia-300">SIMULATED IN-APP NOTIFICATION · no SMS/WhatsApp sent</div>
            </button>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={13} className="text-slate-500" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
