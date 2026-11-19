import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Bot, Download, Loader2, Send, Trash2, User } from 'lucide-react';
import { Card, Markdown, Notice, PageHeader } from '../components/ui';
import { answerLocal, buildLLMContext, retrieve } from '../engine/assistant';
import { askLLM } from '../lib/backend';
import { download, SIM_STAMP } from '../lib/export';
import { useStore } from '../store';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  sources?: { id: string; title: string }[];
  mode?: string;
  at: number;
}
const useChat = create<{ msgs: Msg[]; push: (m: Msg) => void; clear: () => void }>((set, get) => ({
  msgs: [],
  push: (m) => set({ msgs: [...get().msgs, m] }),
  clear: () => set({ msgs: [] }),
}));

const SUGGESTED = [
  'Which villages currently have abnormal water quality?',
  'Why is this village showing a red alert?',
  'Which district has the highest water supply deficit?',
  'What should an operator do when chlorine levels drop?',
  'Which villages have high turbidity?',
  'Show water supply performance for the last 30 days',
  'Which villages have the lowest water equity scores?',
  'Is there a possible relationship between water quality and diarrhoeal cases?',
  'Which pipeline segments require immediate inspection?',
  'What is the projected water demand for the next 30 days?',
];

export default function AssistantPage() {
  const { msgs, push, clear } = useChat();
  const backend = useStore((s) => s.backend);
  const pending = useStore((s) => s.assistantPrompt);
  const setPrompt = useStore((s) => s.setAssistantPrompt);
  const selectedVillageId = useStore((s) => s.selectedVillageId);
  const sim = useStore((s) => s.sim);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    const s = useStore.getState();
    const ctx = { state: s.sim, derived: s.derived, alerts: s.alerts, th: s.thresholds, fc: s.forecast, selectedVillageId: s.selectedVillageId };
    push({ role: 'user', text: q, at: Date.now() });
    setInput('');
    setBusy(true);
    let reply: Msg | null = null;
    if (s.backend.llm) {
      const history = useChat.getState().msgs.slice(-8).map((m) => ({ role: m.role, content: m.text }));
      const r = await askLLM(q, history, buildLLMContext(q, ctx));
      if (r) reply = { role: 'assistant', text: r.text, sources: r.sources, mode: `LLM RAG · ${r.model}`, at: Date.now() };
    }
    if (!reply) {
      const a = answerLocal(q, ctx);
      if (a.villageId && !s.selectedVillageId) s.selectVillage(a.villageId);
      reply = { role: 'assistant', text: a.text, sources: a.sources, mode: s.backend.llm ? 'Local rule-based RAG (LLM call failed — fallback)' : 'Local rule-based RAG fallback (no LLM configured)', at: Date.now() };
    }
    push(reply);
    setBusy(false);
  };

  useEffect(() => {
    if (pending) {
      setPrompt(undefined);
      send(pending);
    }
  }, [pending]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs.length, busy]);

  const exportChat = () => {
    const md = [`# JalNetra Intelligence — conversation summary`, `_${SIM_STAMP}_`, `Generated ${new Date().toLocaleString('en-IN')} · simulation time ${new Date(sim.simTime).toLocaleString('en-IN')}`, '', ...msgs.map((m) => `## ${m.role === 'user' ? 'Question' : `Answer (${m.mode})`}\n\n${m.text}\n${m.sources?.length ? `\nSources: ${m.sources.map((x) => `${x.id} ${x.title}`).join('; ')}\n` : ''}`)].join('\n');
    download('jalnetra_assistant_summary.md', md, 'text/markdown');
  };

  const lastQ = [...msgs].reverse().find((m) => m.role === 'user')?.text ?? '';
  const retrieved = lastQ ? retrieve(lastQ, 3) : [];

  return (
    <div>
      <PageHeader
        title="JalNetra Intelligence — AI Assistant"
        subtitle="Retrieval-augmented assistant grounded in water-quality standards, Mission Bhagiratha programme summary, operator SOPs and the live simulated dashboard state."
        right={
          <>
            <span className={`rounded-md border px-2 py-1 text-[11px] ${backend.llm ? 'border-teal-500/50 text-teal-300' : 'border-amber-500/40 text-amber-300'}`}>
              {backend.llm ? `LLM mode · ${backend.model}` : 'Local rule-based RAG fallback'}
            </span>
            <button className="btn" onClick={exportChat} disabled={!msgs.length}><Download size={12} /> Download summary</button>
            <button className="btn" onClick={clear} disabled={!msgs.length}><Trash2 size={12} /> Clear</button>
          </>
        }
      />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card bodyClass="flex h-[calc(100vh-230px)] min-h-[460px] flex-col p-0">
          <div className="flex-1 space-y-3 overflow-y-auto p-4">
            {!msgs.length && (
              <div className="mx-auto max-w-xl pt-6 text-center">
                <Bot size={32} className="mx-auto text-teal-400" />
                <div className="mt-2 text-sm text-slate-300">Ask about live alerts, villages, districts, SOPs, forecasts or equity.</div>
                <div className="mt-1 text-[12px] text-slate-500">{selectedVillageId ? `Context village: ${sim.villages[selectedVillageId].name}` : 'Tip: select a village on the map, then ask “Why is this village showing a red alert?”'}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === 'user' ? 'justify-end' : ''}`}>
                {m.role === 'assistant' && <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-500/20"><Bot size={14} className="text-teal-300" /></div>}
                <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-water-500/20 text-[13px] text-white' : 'border border-navy-700 bg-navy-950/70'}`}>
                  {m.role === 'user' ? m.text : <Markdown text={m.text} />}
                  {m.role === 'assistant' && (
                    <div className="mt-2 border-t border-navy-800 pt-1.5 text-[10.5px] text-slate-500">
                      <span className="text-fuchsia-300">{m.mode}</span>
                      {m.sources?.length ? <> · Sources: {m.sources.map((s) => `${s.id} ${s.title}`).join('; ')}</> : null} · based on simulated data
                    </div>
                  )}
                </div>
                {m.role === 'user' && <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-navy-700"><User size={14} /></div>}
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-[12px] text-slate-400"><Loader2 size={14} className="animate-spin" /> Retrieving and reasoning over live state…</div>}
            <div ref={endRef} />
          </div>
          <form
            className="flex gap-2 border-t border-navy-700 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input className="inp flex-1 !py-2 text-[13px]" placeholder="Ask JalNetra Intelligence…" value={input} onChange={(e) => setInput(e.target.value)} aria-label="Question" />
            <button className="btn btn-primary" disabled={busy || !input.trim()}><Send size={13} /> Ask</button>
          </form>
        </Card>
        <div className="space-y-4">
          <Card title="Example questions" bodyClass="p-2 space-y-1">
            {SUGGESTED.map((q) => (
              <button key={q} onClick={() => send(q)} className="block w-full rounded-lg px-2.5 py-1.5 text-left text-[12px] text-slate-300 hover:bg-navy-800 hover:text-white">{q}</button>
            ))}
          </Card>
          <Card title="Retrieved knowledge (last question)" bodyClass="p-3 space-y-2">
            {!retrieved.length && <div className="text-[12px] text-slate-500">BM25 retrieval results over the knowledge base appear here.</div>}
            {retrieved.map((d) => (
              <div key={d.id} className="rounded-lg border border-navy-700 p-2 text-[11.5px]">
                <div className="font-semibold text-slate-200">{d.id} · {d.title}</div>
                <div className="mt-0.5 line-clamp-3 text-slate-400">{d.text}</div>
                <div className="mt-0.5 font-mono text-[10px] text-slate-500">score {d.score.toFixed(2)}</div>
              </div>
            ))}
          </Card>
          <Notice>
            {backend.llm
              ? 'Answers are generated by the configured LLM using retrieved knowledge passages plus a live snapshot of the simulated dashboard. Verify before operational use.'
              : 'No external LLM is configured. Answers come from a functional local rule-based engine: BM25 retrieval over the knowledge base + intent handlers that query the live simulation. Start the FastAPI backend with ANTHROPIC_API_KEY to enable LLM answers.'}
          </Notice>
        </div>
      </div>
    </div>
  );
}
