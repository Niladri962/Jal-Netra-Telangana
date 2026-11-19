import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, OctagonAlert } from 'lucide-react';
import type { Severity } from '../engine/types';

// Status palette (reserved for status only) and categorical series palette (validated for the
// navy chart surface with the dataviz palette validator: CVD ΔE ≥ 8.4, contrast ≥ 3:1).
export const STATUS = { normal: '#22c55e', warning: '#f59e0b', critical: '#ef4444', idle: '#64748b' } as const;
export const SERIES = ['#3987e5', '#199e70', '#9085e9', '#d55181', '#c98500', '#d95926'] as const;
export const statusColor = (s: Severity | 'idle') => STATUS[s];
export const sevLabel = (s: Severity) => (s === 'critical' ? 'Critical' : s === 'warning' ? 'Warning' : 'Normal');

export function Card({ title, right, children, className = '', bodyClass = 'p-4' }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <div className="card-h">
          <div className="flex min-w-0 items-center gap-2">{title}</div>
          {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
        </div>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function SevIcon({ s, size = 14 }: { s: Severity; size?: number }) {
  if (s === 'critical') return <OctagonAlert size={size} color={STATUS.critical} aria-hidden />;
  if (s === 'warning') return <AlertTriangle size={size} color={STATUS.warning} aria-hidden />;
  return <CheckCircle2 size={size} color={STATUS.normal} aria-hidden />;
}

export function SevBadge({ s, label }: { s: Severity; label?: string }) {
  const cls =
    s === 'critical' ? 'border-red-500/50 bg-red-500/10 text-red-300' : s === 'warning' ? 'border-amber-500/50 bg-amber-500/10 text-amber-300' : 'border-green-500/40 bg-green-500/10 text-green-300';
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <SevIcon s={s} size={11} />
      {label ?? sevLabel(s)}
    </span>
  );
}

export function SimTag({ text = 'SIMULATED' }: { text?: string }) {
  return (
    <span title="Synthetic data generated for demonstration — not government data" className="inline-flex items-center gap-1 rounded border border-fuchsia-400/40 bg-fuchsia-500/10 px-1.5 py-[1px] text-[10px] font-bold tracking-wider text-fuchsia-300">
      <FlaskConical size={10} aria-hidden />
      {text}
    </span>
  );
}

export function Kpi({ label, value, unit, sub, s, icon, onClick }: { label: string; value: ReactNode; unit?: string; sub?: ReactNode; s?: Severity; icon?: ReactNode; onClick?: () => void }) {
  const ring = s === 'critical' ? 'border-red-500/50' : s === 'warning' ? 'border-amber-500/40' : 'border-navy-700/70';
  return (
    <button onClick={onClick} className={`card group flex flex-col items-start gap-1 border ${ring} px-3.5 py-3 text-left transition hover:border-teal-500/50`}>
      <div className="flex w-full items-center justify-between gap-2">
        <span className="lbl leading-tight">{label}</span>
        <span className="text-slate-500 group-hover:text-teal-400">{icon}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono text-2xl font-semibold text-white tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
      </div>
      {sub && <div className="flex items-center gap-1 text-[11px] text-slate-400">{s && s !== 'normal' && <SevIcon s={s} size={11} />}{sub}</div>}
    </button>
  );
}

export function Stat({ label, value, unit, s }: { label: string; value: ReactNode; unit?: string; s?: Severity }) {
  return (
    <div className="rounded-lg border border-navy-700/70 bg-navy-950/60 px-3 py-2">
      <div className="lbl">{label}</div>
      <div className="mt-0.5 flex items-center gap-1.5 font-mono text-sm font-semibold tabular-nums text-white">
        {s && <SevIcon s={s} size={12} />}
        {value}
        {unit && <span className="font-sans text-[11px] font-normal text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, right, tag = true }: { title: string; subtitle?: ReactNode; right?: ReactNode; tag?: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
          {tag && <SimTag />}
        </div>
        {subtitle && <p className="mt-0.5 max-w-3xl text-[13px] text-slate-400">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <div className={`rounded-lg border px-3 py-2 text-[12px] leading-relaxed ${tone === 'warn' ? 'border-amber-500/40 bg-amber-500/5 text-amber-200/90' : 'border-water-500/30 bg-water-500/5 text-sky-200/80'}`}>{children}</div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-navy-700 bg-navy-950 p-0.5">
      {items.map((i) => (
        <button key={i.id} onClick={() => onChange(i.id)} className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${value === i.id ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-slate-200'}`}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export function Meter({ value, max = 100, s }: { value: number; max?: number; s: Severity }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-navy-800" role="meter" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (value / max) * 100)}%`, background: STATUS[s] }} />
    </div>
  );
}

/** Minimal markdown renderer for assistant answers (headings, bold, italics, bullets, tables). */
export function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  const out: ReactNode[] = [];
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*|_[^_]+_)/g).map((p, i) =>
      p.startsWith('**') ? <strong key={i} className="text-white">{p.slice(2, -2)}</strong> : p.startsWith('_') && p.endsWith('_') && p.length > 2 ? <em key={i} className="text-slate-400">{p.slice(1, -1)}</em> : p,
    );
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|[-\s|]+\|$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      out.push(
        <div key={i} className="overflow-x-auto">
          <table>
            <thead><tr>{rows[0].map((c, j) => <th key={j}>{inline(c)}</th>)}</tr></thead>
            <tbody>{rows.slice(1).map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
    } else if (l.startsWith('### ')) out.push(<h3 key={i}>{inline(l.slice(4))}</h3>);
    else if (/^\s*- /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*- /.test(lines[i])) items.push(lines[i++].replace(/^\s*- /, ''));
      i--;
      out.push(<ul key={i}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ul>);
    } else if (/^\d+\. /.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) items.push(lines[i++].replace(/^\d+\. /, ''));
      i--;
      out.push(<ol key={i}>{items.map((x, j) => <li key={j}>{inline(x)}</li>)}</ol>);
    } else if (l.trim()) out.push(<p key={i}>{inline(l)}</p>);
  }
  return <div className="md text-[13px] leading-relaxed text-slate-300">{out}</div>;
}

export const fmtNum = (n: number, d = 0) => n.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
export const fmtTime = (t: number) => new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export const chartTooltip = {
  contentStyle: { background: '#0a1630', border: '1px solid #264580', borderRadius: 8, fontSize: 12, color: '#e2e8f0' },
  labelStyle: { color: '#94a3b8' },
  itemStyle: { color: '#e2e8f0' },
  cursor: { stroke: '#7cc4fa', strokeWidth: 1, strokeDasharray: '3 3' },
};
export const barCursor = { fill: 'rgba(124,196,250,0.08)' };
