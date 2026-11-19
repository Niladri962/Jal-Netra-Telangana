import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { Award, BookOpen, CheckCircle2, Circle, FlaskConical, GraduationCap, Link2, RotateCcw, Unlink } from 'lucide-react';
import MapView from '../components/MapView';
import { Card, Meter, Notice, PageHeader, SevBadge, SevIcon, Stat, STATUS, Tabs } from '../components/ui';
import { evalNode } from '../engine/compute';
import { round } from '../engine/rng';
import { orpFrom, PARAM_INFO } from '../engine/thresholds';
import type { Param, Readings } from '../engine/types';
import { useStore } from '../store';

type LabParam = 'tds' | 'turbidity' | 'chlorine' | 'ph' | 'flow' | 'pressure';
const LAB_PARAMS: { p: LabParam; min: number; max: number; step: number }[] = [
  { p: 'tds', min: 0, max: 2000, step: 10 },
  { p: 'turbidity', min: 0, max: 50, step: 0.1 },
  { p: 'chlorine', min: 0, max: 5, step: 0.01 },
  { p: 'ph', min: 3, max: 12, step: 0.05 },
  { p: 'flow', min: 0, max: 200, step: 1 },
  { p: 'pressure', min: 0, max: 10, step: 0.05 },
];
const SAFE: Record<LabParam, number> = { tds: 300, turbidity: 1, chlorine: 0.5, ph: 7.4, flow: 100, pressure: 1.5 };
const LAB_POP = 5000;
const LAB_HOURS = 20;

const SCENARIOS: { id: string; name: string; values: Partial<Record<LabParam, number>>; story: string }[] = [
  { id: 'safe', name: '1. Safe water conditions', values: { ...SAFE, turbidity: 0.5 }, story: 'All parameters inside BIS acceptable limits and normal operating ranges.' },
  { id: 'chlor', name: '2. Chlorination failure', values: { chlorine: 0.05 }, story: 'The hypochlorite dosing pump has stopped. Residual chlorine decays to 0.05 mg/L at the tail end.' },
  { id: 'turb', name: '3. High turbidity contamination risk', values: { turbidity: 15, chlorine: 0.18 }, story: 'A filter breakthrough after heavy rain sends 15 NTU water into the network; particles consume chlorine.' },
  { id: 'tds', name: '4. High TDS', values: { tds: 1200 }, story: 'A borewell has been cross-connected to the supply main, blending mineralised groundwater.' },
  { id: 'leak', name: '5. Pipeline leakage & reduced supply', values: { flow: 25, pressure: 0.4 }, story: 'A burst on the distribution main: downstream flow falls to 25 L/min and pressure collapses.' },
  { id: 'ph', name: '6. Acidic water (dosing error)', values: { ph: 5.6 }, story: 'An alum over-dose at the treatment plant drops pH to 5.6, increasing corrosivity.' },
  { id: 'combo', name: '7. Combined event (advanced)', values: { turbidity: 8.5, chlorine: 0.08, pressure: 0.5, flow: 60 }, story: 'Low pressure allows ingress at a leaking joint: turbidity 8.5 NTU, chlorine 0.08 mg/L.' },
];

const EXPERIMENTS: { id: string; task: string; check: (r: Record<LabParam, number>, risk: number) => boolean; learn: string }[] = [
  { id: 'e1', task: 'Lower free chlorine below 0.2 mg/L and observe the warning', check: (r) => r.chlorine < 0.2, learn: 'Below 0.2 mg/L the network loses its protection against re-contamination (BIS minimum residual).' },
  { id: 'e2', task: 'Push turbidity above 5 NTU (BIS permissible limit)', check: (r) => r.turbidity > 5, learn: 'Above 5 NTU particles can shield microbes from chlorine — status becomes critical.' },
  { id: 'e3', task: 'Raise TDS to 1,200 mg/L — note the status is a warning, not critical', check: (r) => r.tds >= 1200, learn: 'High TDS is an acceptability concern; it is not by itself an acute-toxicity signal.' },
  { id: 'e4', task: 'Reduce flow to 25 L/min and read the delivery reduction', check: (r) => r.flow <= 25, learn: 'A 75% flow drop cuts the village’s daily delivery by the same share — suspect leakage, blockage or pump failure.' },
  { id: 'e5', task: 'Find a pH that is out of range on the alkaline side (> 8.5)', check: (r) => r.ph > 8.5, learn: 'At high pH less hypochlorous acid is present, so chlorine disinfects less effectively.' },
  { id: 'e6', task: 'Get the risk score above 70 using any two parameters', check: (_r, risk) => risk > 70, learn: 'Any critical exceedance floors the risk score at 70; multiple issues add up.' },
  { id: 'e7', task: 'Restore all values to the safe baseline', check: (r) => (Object.keys(SAFE) as LabParam[]).every((k) => Math.abs(r[k] - SAFE[k]) < 1e-6), learn: 'Restoring the condition auto-resolves the alert — alerts are always tied to live data.' },
];

const QUIZ = [
  { q: 'What is the BIS IS 10500 acceptable limit for turbidity?', o: ['0.1 NTU', '1 NTU', '5 NTU', '10 NTU'], a: 1, e: '1 NTU acceptable; 5 NTU is the permissible limit in the absence of an alternate source.' },
  { q: 'Minimum free residual chlorine recommended at the consumer end?', o: ['0.02 mg/L', '0.2 mg/L', '2 mg/L', '5 mg/L'], a: 1, e: 'BIS specifies a minimum of 0.2 mg/L (0.5 mg/L where viral protection is needed).' },
  { q: 'A sensor shows TDS of 1,200 mg/L. The correct interpretation is…', o: ['Water is acutely toxic', 'Above acceptable limit — confirm by lab test and investigate source', 'Within BIS acceptable limit', 'Chlorine must be increased'], a: 1, e: 'High TDS is mainly a taste/acceptability issue; confirm and test for specific ions.' },
  { q: 'Why does high turbidity matter for disinfection?', o: ['It raises pH', 'Particles shield microbes and consume chlorine', 'It increases pressure', 'It has no effect'], a: 1, e: 'Suspended particles protect micro-organisms and exert chlorine demand.' },
  { q: 'Downstream flow drops while upstream is unchanged and pressure falls. Most likely?', o: ['Measurement uncertainty', 'Suspected leakage', 'Upstream pump failure', 'Higher rainfall'], a: 1, e: 'A balance gap with pressure loss is consistent with a physical leak.' },
  { q: 'What is the acceptable pH range under BIS IS 10500?', o: ['5.5–7.5', '6.5–8.5', '7.0–9.5', '4–10'], a: 1, e: '6.5–8.5 with no relaxation.' },
  { q: 'A health surveillance watch in JalNetra means…', o: ['An outbreak is confirmed', 'Disease has been diagnosed', 'The village is prioritised for confirmatory sampling and follow-up', 'Water must be shut off'], a: 2, e: 'It is an early-warning prioritisation signal, not a diagnosis or proof of causation.' },
  { q: 'Before acting on an online chlorine sensor reading you should…', o: ['Act immediately without checks', 'Verify with a DPD field test kit', 'Ignore it', 'Wait one month'], a: 1, e: 'Sensor readings are indicators; confirm with DPD tests and lab samples.' },
];

const useLab = create<{ quiz: Record<number, number>; done: Record<string, boolean>; explored: Record<string, boolean>; set: (p: Partial<{ quiz: Record<number, number>; done: Record<string, boolean>; explored: Record<string, boolean> }>) => void }>((set) => ({
  quiz: {},
  done: {},
  explored: {},
  set: (p) => set(p),
}));

const toReadings = (r: Record<LabParam, number>): Readings => ({ ...r, orp: Math.round(orpFrom(r.chlorine, r.ph, r.turbidity)) });

export default function LabPage() {
  const sim = useStore((s) => s.sim);
  const derived = useStore((s) => s.derived);
  const th = useStore((s) => s.thresholds);
  const alerts = useStore((s) => s.alerts);
  const setParam = useStore((s) => s.setParam);
  const restoreNode = useStore((s) => s.restoreNode);
  const featured = useStore((s) => s.plan.featuredVillageId);
  const lab = useLab();
  const [mode, setMode] = useState<'beginner' | 'advanced'>('beginner');
  const [values, setValues] = useState<Record<LabParam, number>>(SAFE);
  const [scenario, setScenario] = useState<string>('safe');
  const [linked, setLinked] = useState<string | null>(null);
  const [linkVillage, setLinkVillage] = useState(featured);
  const linkBaseline = useRef<{ alerts: number; qAlerts: number; supply: number } | null>(null);

  const base = useMemo(() => evalNode(toReadings(SAFE), 100, th), [th]);
  const cur = useMemo(() => evalNode(toReadings(values), 100, th), [values, th]);
  const crossed = (Object.keys(cur.params) as Param[]).filter((p) => cur.params[p].severity !== 'normal');

  // Experiments & scenario tracking
  useEffect(() => {
    const done = { ...lab.done };
    let changed = false;
    for (const e of EXPERIMENTS) if (!done[e.id] && e.check(values, cur.risk)) { done[e.id] = true; changed = true; }
    if (changed) lab.set({ done });
  }, [values, cur.risk]); // eslint-disable-line react-hooks/exhaustive-deps

  const linkedTap = linked ? sim.villages[linked].nodeIds[sim.villages[linked].nodeIds.length - 1] : null;
  const push = (next: Record<LabParam, number>, changedKeys: LabParam[]) => {
    setValues(next);
    if (linkedTap) for (const k of changedKeys) setParam(linkedTap, k, next[k], 'lab');
  };
  const setOne = (p: LabParam, v: number) => push({ ...values, [p]: v }, [p]);
  const applyScenario = (id: string) => {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    const next = { ...SAFE, ...sc.values };
    setScenario(id);
    lab.set({ explored: { ...lab.explored, [id]: true } });
    push(next, Object.keys(next) as LabParam[]);
  };
  const link = () => {
    linkBaseline.current = { alerts: alerts.filter((a) => a.status === 'active').length, qAlerts: derived.kpi.qualityAlertVillages, supply: derived.kpi.supplyMLD };
    setLinked(linkVillage);
    const tap = sim.villages[linkVillage].nodeIds[sim.villages[linkVillage].nodeIds.length - 1];
    for (const k of Object.keys(values) as LabParam[]) setParam(tap, k, values[k], 'lab');
  };
  const unlink = () => {
    if (linkedTap) restoreNode(linkedTap);
    setLinked(null);
  };

  const quizScore = QUIZ.reduce((a, q, i) => a + (lab.quiz[i] === q.a ? 1 : 0), 0);
  const expDone = EXPERIMENTS.filter((e) => lab.done[e.id]).length;
  const scenDone = SCENARIOS.filter((s) => lab.explored[s.id]).length;
  const trainingScore = Math.round(40 * (quizScore / QUIZ.length) + 40 * (expDone / EXPERIMENTS.length) + 20 * (scenDone / SCENARIOS.length));
  const deliveryKL = (values.flow * LAB_HOURS * 60) / 1000;
  const baseKL = (SAFE.flow * LAB_HOURS * 60) / 1000;
  const lpcd = (deliveryKL * 1000) / LAB_POP;

  const activeNow = alerts.filter((a) => a.status === 'active').length;
  const sc = SCENARIOS.find((s) => s.id === scenario);

  return (
    <div>
      <PageHeader
        title="JalNetra Water Intelligence Lab"
        subtitle="Training laboratory for students, officials, operators and administrators: change a parameter and see — with real cause and effect — how drinking-water safety and distribution respond."
        right={
          <>
            <Tabs value={mode} onChange={setMode} items={[{ id: 'beginner', label: <span className="flex items-center gap-1"><BookOpen size={12} /> Beginner</span> }, { id: 'advanced', label: <span className="flex items-center gap-1"><GraduationCap size={12} /> Advanced operator</span> }]} />
            <button className="btn" onClick={() => { push(SAFE, Object.keys(SAFE) as LabParam[]); setScenario('safe'); }}><RotateCcw size={12} /> Reset to normal</button>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {SCENARIOS.filter((s) => mode === 'advanced' || s.id !== 'combo').map((s) => (
          <button key={s.id} onClick={() => applyScenario(s.id)} className={`rounded-lg border px-3 py-1.5 text-[12px] transition ${scenario === s.id ? 'border-teal-400 bg-teal-500/15 text-teal-200' : 'border-navy-600 bg-navy-900 text-slate-300 hover:border-navy-500'}`}>
            {lab.explored[s.id] && <CheckCircle2 size={11} className="mr-1 inline text-teal-400" />}
            {s.name}
          </button>
        ))}
      </div>
      {sc && <div className="mb-4"><Notice><b>Scenario:</b> {sc.story}</Notice></div>}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card title={<><FlaskConical size={14} className="text-teal-400" /> Interactive parameters</>} bodyClass="p-4 space-y-4">
          {LAB_PARAMS.map(({ p, min, max, step }) => {
            const info = PARAM_INFO[p];
            const e = cur.params[p];
            return (
              <div key={p}>
                <div className="flex items-center justify-between">
                  <label htmlFor={`lab-${p}`} className="flex items-center gap-1.5 text-[13px] font-medium text-slate-200"><SevIcon s={e.severity} /> {info.label}</label>
                  <div className="flex items-center gap-2">
                    <input aria-label={`${info.label} value`} type="number" min={min} max={max} step={step} value={values[p]} onChange={(ev) => ev.target.value !== '' && setOne(p, Number(ev.target.value))} className="inp w-[80px] !py-0.5 text-right font-mono" />
                    <span className="w-10 text-[11px] text-slate-500">{info.unit === 'pH' ? '' : info.unit}</span>
                  </div>
                </div>
                <input id={`lab-${p}`} type="range" min={min} max={max} step={step} value={values[p]} onChange={(ev) => setOne(p, Number(ev.target.value))} className="mt-1 w-full" />
                <div className="flex justify-between text-[10.5px] text-slate-500">
                  <span>{min}</span>
                  <span>{mode === 'advanced' ? info.standard : p === 'flow' ? 'Normal ≈ 100 L/min (lab village design flow)' : p === 'pressure' ? 'Normal ≈ 1–3 bar' : `Safe baseline ${SAFE[p]}`}</span>
                  <span>{max}</span>
                </div>
              </div>
            );
          })}
          <div className="rounded-lg border border-navy-700 bg-navy-950 px-3 py-2 text-[12px] text-slate-400">
            ORP (derived): <span className="font-mono text-white">{toReadings(values).orp} mV</span>{mode === 'advanced' && ' — computed from chlorine, pH and turbidity; a supporting disinfection indicator, not a BIS parameter.'}
          </div>
        </Card>

        <div className="space-y-4">
          <div className={`card border-2 p-4 ${cur.status === 'critical' ? 'border-red-500/60' : cur.status === 'warning' ? 'border-amber-500/50' : 'border-green-500/40'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="lbl">Water quality status</div>
                <div className="mt-1 flex items-center gap-2 text-2xl font-bold" style={{ color: STATUS[cur.status] }}>
                  <SevIcon s={cur.status} size={22} /> {cur.status === 'critical' ? 'CRITICAL ALERT' : cur.status === 'warning' ? 'WARNING' : 'SAFE / NORMAL'}
                </div>
              </div>
              <div className="w-40 text-right">
                <div className="lbl">Overall risk score</div>
                <div className="font-mono text-3xl font-bold text-white">{cur.risk}</div>
                <Meter value={cur.risk} s={cur.status} />
              </div>
            </div>
            <div className="mt-3 text-[12px] text-slate-300">
              {crossed.length === 0 ? 'No standards or operational thresholds crossed.' : <>Thresholds crossed: {crossed.map((p) => <span key={p} className="mr-2 inline-flex items-center gap-1"><SevBadge s={cur.params[p].severity} label={`${PARAM_INFO[p].short} ${cur.params[p].direction}`} /></span>)}</>}
            </div>
          </div>

          <Card title="What this means & what to do" bodyClass="p-3 space-y-2 max-h-[340px] overflow-y-auto">
            {crossed.length === 0 && <div className="text-[12.5px] text-green-200/90">{mode === 'beginner' ? 'The water meets the safety and supply targets used in this lab. Try a scenario above!' : 'All parameters within configured limits. Residual chlorine sufficient for network protection; turbidity compatible with effective disinfection.'}</div>}
            {crossed.map((p) => {
              const info = PARAM_INFO[p];
              const k = cur.params[p].direction === 'low' ? info.low : info.high;
              if (!k) return null;
              return (
                <div key={p} className="rounded-lg border border-navy-700 p-2.5 text-[12px]">
                  <div className="mb-1 flex items-center gap-1.5 font-semibold text-white"><SevIcon s={cur.params[p].severity} /> {k.title} — {values[p as LabParam] ?? toReadings(values).orp} {info.unit}</div>
                  <p className="text-slate-300">{k.meaning}</p>
                  {mode === 'advanced' && <p className="mt-1 text-slate-400">Possible causes: {k.causes.join('; ')}.</p>}
                  <p className="mt-1 text-slate-400">Consequences: {k.consequences.join('; ')}.</p>
                  <ul className="ml-4 mt-1 list-disc text-slate-300">{k.actions.slice(0, mode === 'advanced' ? 6 : 3).map((a) => <li key={a}>{a}</li>)}</ul>
                  {mode === 'advanced' && <div className="mt-1 text-[10.5px] text-slate-500">Reference: {info.standard}</div>}
                </div>
              );
            })}
            {values.flow < 70 && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12px] text-amber-100/90">
                <b>Delivery impact:</b> {round(deliveryKL, 1)} kL/day vs {round(baseKL, 1)} kL/day normal — a <b>{round((1 - deliveryKL / baseKL) * 100, 0)}%</b> reduction. For a lab village of {LAB_POP.toLocaleString('en-IN')} people that is <b>{round(lpcd, 0)} LPCD</b> against the {th.lpcdNorm} LPCD norm. Suggested field inspection: walk the distribution main, check pump status, valves and air valves.
              </div>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Before vs after — baseline compared with modified conditions" className="xl:col-span-2">
          <table className="tbl">
            <thead><tr><th>Parameter</th><th>Baseline</th><th>Status</th><th>Modified</th><th>Status</th><th>Change</th></tr></thead>
            <tbody>
              {([...LAB_PARAMS.map((x) => x.p), 'orp'] as Param[]).map((p) => {
                const b = p === 'orp' ? toReadings(SAFE).orp : SAFE[p as LabParam];
                const m = p === 'orp' ? toReadings(values).orp : values[p as LabParam];
                return (
                  <tr key={p}>
                    <td>{PARAM_INFO[p].label}</td>
                    <td className="font-mono">{b} {PARAM_INFO[p].unit === 'pH' ? '' : PARAM_INFO[p].unit}</td>
                    <td><SevBadge s={base.params[p].severity} /></td>
                    <td className="font-mono">{m} {PARAM_INFO[p].unit === 'pH' ? '' : PARAM_INFO[p].unit}</td>
                    <td><SevBadge s={cur.params[p].severity} /></td>
                    <td className="font-mono" style={{ color: m === b ? undefined : '#7cc4fa' }}>{m === b ? '—' : `${m > b ? '+' : ''}${round(m - b, 2)}`}</td>
                  </tr>
                );
              })}
              <tr><td className="font-semibold">Risk score</td><td className="font-mono">{base.risk}</td><td><SevBadge s={base.status} /></td><td className="font-mono">{cur.risk}</td><td><SevBadge s={cur.status} /></td><td className="font-mono">{round(cur.risk - base.risk, 1)}</td></tr>
              <tr><td className="font-semibold">Daily delivery</td><td className="font-mono">{round(baseKL, 1)} kL</td><td /><td className="font-mono">{round(deliveryKL, 1)} kL</td><td /><td className="font-mono">{round(deliveryKL - baseKL, 1)}</td></tr>
            </tbody>
          </table>
        </Card>

        <Card title={<><Link2 size={14} className="text-teal-400" /> Link lab to a simulated village</>} bodyClass="p-3 space-y-2">
          <p className="text-[12px] text-slate-400">When linked, every slider change is written to the village’s end-point tap sensor — updating its status, the Telangana map, alerts and the command-centre KPIs.</p>
          <div className="flex gap-2">
            <select className="inp flex-1" value={linkVillage} onChange={(e) => setLinkVillage(e.target.value)} disabled={!!linked} aria-label="Village to link">
              {sim.villageOrder.filter((v) => sim.villages[v].demo).map((v) => <option key={v} value={v}>{sim.villages[v].name} ({sim.districts.find((d) => d.id === sim.villages[v].districtId)?.name})</option>)}
            </select>
            {linked ? <button className="btn btn-danger" onClick={unlink}><Unlink size={12} /> Unlink & restore</button> : <button className="btn btn-primary" onClick={link}><Link2 size={12} /> Link</button>}
          </div>
          {linked && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Village status" value={derived.villages[linked].status} s={derived.villages[linked].status} />
                <Stat label="Health priority" value={derived.villages[linked].healthPriority} s={derived.villages[linked].healthStatus} />
                <Stat label="Active alerts (state)" value={`${activeNow} (${activeNow - (linkBaseline.current?.alerts ?? activeNow) >= 0 ? '+' : ''}${activeNow - (linkBaseline.current?.alerts ?? activeNow)})`} />
                <Stat label="Villages w/ quality alerts" value={`${derived.kpi.qualityAlertVillages} (${derived.kpi.qualityAlertVillages - (linkBaseline.current?.qAlerts ?? 0) >= 0 ? '+' : ''}${derived.kpi.qualityAlertVillages - (linkBaseline.current?.qAlerts ?? 0)})`} />
              </div>
              <MapView height={180} compact focusVillageId={linked} />
            </>
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card title="Guided experiments" bodyClass="p-3 space-y-1.5">
          {EXPERIMENTS.map((e) => (
            <div key={e.id} className="flex gap-2 text-[12px]">
              {lab.done[e.id] ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-teal-400" /> : <Circle size={15} className="mt-0.5 shrink-0 text-slate-600" />}
              <div>
                <div className={lab.done[e.id] ? 'text-slate-300' : 'text-slate-200'}>{e.task}</div>
                {lab.done[e.id] && <div className="text-[11px] text-teal-300/80">✓ {e.learn}</div>}
              </div>
            </div>
          ))}
        </Card>
        <Card title="Knowledge assessment quiz" right={<span className="font-mono text-[12px]">{quizScore}/{QUIZ.length}</span>} bodyClass="p-3 space-y-3 max-h-[440px] overflow-y-auto">
          {QUIZ.map((q, i) => {
            const ans = lab.quiz[i];
            return (
              <div key={i} className="text-[12px]">
                <div className="mb-1 text-slate-200">{i + 1}. {q.q}</div>
                <div className="grid gap-1">
                  {q.o.map((o, j) => (
                    <button
                      key={j}
                      disabled={ans !== undefined}
                      onClick={() => lab.set({ quiz: { ...lab.quiz, [i]: j } })}
                      className={`rounded-md border px-2 py-1 text-left ${ans === undefined ? 'border-navy-600 hover:border-teal-500/50' : j === q.a ? 'border-green-500/60 bg-green-500/10 text-green-200' : j === ans ? 'border-red-500/60 bg-red-500/10 text-red-200' : 'border-navy-700 text-slate-500'}`}
                    >
                      {o}
                    </button>
                  ))}
                </div>
                {ans !== undefined && <div className="mt-1 text-[11px] text-slate-400">{ans === q.a ? '✓ Correct. ' : '✗ '}{q.e}</div>}
              </div>
            );
          })}
          <button className="btn" onClick={() => lab.set({ quiz: {} })}><RotateCcw size={12} /> Retake quiz</button>
        </Card>
        <Card title={<><Award size={14} className="text-teal-400" /> Training performance</>} bodyClass="p-4 space-y-3">
          <div className="text-center">
            <div className="font-mono text-5xl font-bold text-white">{trainingScore}</div>
            <div className="text-[12px] text-slate-400">/ 100 training score</div>
          </div>
          <Meter value={trainingScore} s={trainingScore >= 70 ? 'normal' : trainingScore >= 40 ? 'warning' : 'critical'} />
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Quiz (40%)" value={`${quizScore}/${QUIZ.length}`} />
            <Stat label="Experiments (40%)" value={`${expDone}/${EXPERIMENTS.length}`} />
            <Stat label="Scenarios (20%)" value={`${scenDone}/${SCENARIOS.length}`} />
          </div>
          <div className="text-[12px] text-slate-400">{trainingScore >= 80 ? 'Excellent — ready for operator duty in the simulation.' : trainingScore >= 50 ? 'Good progress — complete the remaining experiments.' : 'Start with the scenarios and guided experiments.'}</div>
          <button className="btn" onClick={() => lab.set({ quiz: {}, done: {}, explored: {} })}><RotateCcw size={12} /> Reset progress</button>
        </Card>
      </div>
    </div>
  );
}
