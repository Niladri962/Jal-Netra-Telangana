// Client for the optional FastAPI backend. The app is fully functional without it.
import type { Param } from '../engine/types';

export interface BackendHealth {
  ok: boolean;
  llm: boolean;
  model?: string;
  ingest: boolean;
}

export async function probeBackend(): Promise<BackendHealth | null> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/api/health', { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const j = await r.json();
    return { ok: true, llm: !!j.llm_configured, model: j.model, ingest: j.websocket !== false };
  } catch {
    return null;
  }
}

export interface LLMAnswer {
  text: string;
  sources: { id: string; title: string }[];
  model: string;
}

export async function askLLM(question: string, history: { role: 'user' | 'assistant'; content: string }[], context: unknown): Promise<LLMAnswer | null> {
  try {
    const r = await fetch('/api/assistant', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history, context }) });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.text) return null;
    return j as LLMAnswer;
  } catch {
    return null;
  }
}

export interface TelemetryPacket {
  node_id: string;
  ts: string;
  readings: Partial<Record<Param, number>>;
  transport: string;
  simulated: boolean;
}

export function connectTelemetry(onPacket: (p: TelemetryPacket) => void, onState: (open: boolean) => void): () => void {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  let ws: WebSocket | null = null;
  try {
    ws = new WebSocket(`${proto}://${location.host}/ws/telemetry`);
  } catch {
    onState(false);
    return () => undefined;
  }
  ws.onopen = () => onState(true);
  ws.onclose = () => onState(false);
  ws.onerror = () => onState(false);
  ws.onmessage = (ev) => {
    try {
      onPacket(JSON.parse(ev.data));
    } catch {
      /* ignore malformed packets */
    }
  };
  return () => ws?.close();
}
