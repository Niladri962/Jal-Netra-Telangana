"""Retrieval-augmented generation for JalNetra Intelligence.

Retrieval: BM25 over the shared knowledge base (standards, programme summary, SOPs, methods).
Grounding: the browser sends a compact snapshot of the *live simulated* dashboard state.
Generation: Claude (Anthropic SDK). Without credentials the endpoint reports unavailable and the
browser uses its local rule-based fallback.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass

from .config import EFFORT, KB_PATH, MODEL, llm_configured

STOP = set(
    "the a an of to and or in on at for is are be by with what which why how do does should when this that from as it its can show me my there any".split()
)


def tokenize(text: str) -> list[str]:
    return [w for w in re.sub(r"[^a-z0-9.\s]", " ", text.lower()).split() if len(w) > 1 and w not in STOP]


@dataclass
class Doc:
    id: str
    title: str
    type: str
    text: str


class BM25:
    def __init__(self, docs: list[Doc], k1: float = 1.2, b: float = 0.75):
        self.docs = docs
        self.k1, self.b = k1, b
        self.toks = [tokenize(f"{d.title} {d.title} {d.text}") for d in docs]  # title weighted x2
        self.avg = sum(len(t) for t in self.toks) / max(1, len(self.toks))
        self.df: dict[str, int] = {}
        for t in self.toks:
            for w in set(t):
                self.df[w] = self.df.get(w, 0) + 1

    def search(self, query: str, k: int = 4) -> list[tuple[Doc, float]]:
        q = tokenize(query)
        n = len(self.docs)
        scored = []
        for doc, toks in zip(self.docs, self.toks):
            s = 0.0
            for w in q:
                f = sum(1 for x in toks if x == w or (len(w) > 4 and x.startswith(w[:5])))
                if not f:
                    continue
                df = self.df.get(w, 0)
                idf = math.log(1 + (n - df + 0.5) / (df + 0.5))
                s += idf * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * len(toks) / self.avg))
            if s > 0:
                scored.append((doc, s))
        return sorted(scored, key=lambda x: -x[1])[:k]


KB = [Doc(**d) for d in json.loads(KB_PATH.read_text(encoding="utf-8"))]
INDEX = BM25(KB)

SYSTEM_PROMPT = """You are JalNetra Intelligence, the decision-support assistant inside a SIMULATED water-governance command centre for rural drinking water in Telangana, India (a Mission Bhagiratha-style demonstration).

Ground every answer in two inputs supplied with each question:
1. RETRIEVED KNOWLEDGE: passages from water-quality standards, programme summaries, operator SOPs and method notes, each tagged with an id like KB-04. Cite the ids you rely on in square brackets, e.g. [KB-04].
2. LIVE SIMULATION STATE: a JSON snapshot of the current simulated dashboard (KPIs, active alerts, focus village with sensor readings, districts, flagged pipeline segments, forecasts, health correlation). Use these exact numbers; do not invent villages, readings or figures that are not in the snapshot.

Rules:
- All data are synthetic. Never present them as real government data or real-time Mission Bhagiratha readings; mention this briefly when you give figures.
- Sensor values are indicators, not certified laboratory measurements: recommend confirmatory testing before action.
- Public-health outputs are early-warning prioritisation only. Never claim a disease diagnosis, a confirmed outbreak, or that a water anomaly caused cases.
- Do not label water-balance gaps as theft; distinguish suspected leakage, possible unauthorised draw-off and measurement uncertainty.
- Do not equate high TDS with acute toxicity.
- If the snapshot lacks what is needed, say so and suggest where in the dashboard to look.

Format: concise Markdown for an operator or official. Use a short heading (### ...), bullet points, and small tables (| a | b |) when listing villages or segments. Bold key numbers. Keep answers under about 300 words unless the user asks for more."""


def retrieve(question: str, k: int = 4) -> list[dict]:
    return [{"id": d.id, "title": d.title, "text": d.text, "score": round(s, 3)} for d, s in INDEX.search(question, k)]


class LLMUnavailable(Exception):
    pass


def _build_messages(question: str, history: list[dict], context: dict, passages: list[dict]) -> list[dict]:
    knowledge = "\n\n".join(f"[{p['id']}] {p['title']}\n{p['text']}" for p in passages) or "(no passages matched)"
    user_turn = (
        f"RETRIEVED KNOWLEDGE:\n{knowledge}\n\n"
        f"LIVE SIMULATION STATE (JSON):\n{json.dumps(context, ensure_ascii=False, default=str)[:60000]}\n\n"
        f"QUESTION: {question}"
    )
    msgs = [
        {"role": m["role"], "content": str(m["content"])[:4000]}
        for m in history[-8:]
        if m.get("role") in ("user", "assistant") and m.get("content")
    ]
    # The API needs alternating turns that start with a user turn and end before our new user turn.
    while msgs and msgs[0]["role"] != "user":
        msgs.pop(0)
    cleaned: list[dict] = []
    for m in msgs:
        if cleaned and cleaned[-1]["role"] == m["role"]:
            cleaned[-1]["content"] += "\n\n" + m["content"]
        else:
            cleaned.append(m)
    if cleaned and cleaned[-1]["role"] == "user":
        cleaned.pop()
    cleaned.append({"role": "user", "content": user_turn})
    return cleaned


def answer(question: str, history: list[dict], context: dict) -> dict:
    """Call Claude with retrieved passages + live state. Raises LLMUnavailable if that is not possible."""
    if not llm_configured():
        raise LLMUnavailable("No Anthropic credentials configured")
    try:
        import anthropic  # noqa: PLC0415
    except ImportError as e:  # pragma: no cover
        raise LLMUnavailable("anthropic package not installed") from e
    client = anthropic.Anthropic()

    passages = retrieve(question)
    params = dict(
        model=MODEL,
        max_tokens=16000,
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        messages=_build_messages(question, history, context, passages),
    )
    # Server-side refusal fallback ("default" routes by refusal category) and effort control.
    extras = {"fallbacks": "default", "output_config": {"effort": EFFORT}}
    betas = ["server-side-fallback-2026-07-01"]
    try:
        try:
            resp = client.beta.messages.create(betas=betas, **params, **extras)
        except TypeError:
            # Older SDK releases do not accept these keyword arguments; send them as raw body fields.
            resp = client.beta.messages.create(betas=betas, **params, extra_body=extras)
    except anthropic.AuthenticationError as e:
        raise LLMUnavailable("Authentication failed — check ANTHROPIC_API_KEY") from e
    except anthropic.RateLimitError as e:
        raise LLMUnavailable("Rate limited — try again shortly") from e
    except anthropic.APIStatusError as e:
        raise LLMUnavailable(f"API error {e.status_code}") from e
    except anthropic.APIConnectionError as e:
        raise LLMUnavailable("Could not reach the Anthropic API") from e

    if resp.stop_reason == "refusal":
        text = "The model declined to answer this request. Please rephrase it, or use the local engine."
    else:
        text = "".join(getattr(b, "text", "") for b in resp.content if getattr(b, "type", "") == "text").strip()
        if resp.stop_reason == "max_tokens":
            text += "\n\n_(answer truncated)_"
    if not text:
        raise LLMUnavailable("Empty response")
    return {
        "text": text,
        "sources": [{"id": p["id"], "title": p["title"]} for p in passages],
        "model": getattr(resp, "model", MODEL),
    }
