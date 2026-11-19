"""JalNetra FastAPI backend.

Optional services for the browser simulation engine:
  GET  /api/health                      status, LLM availability
  POST /api/assistant                   RAG assistant (BM25 retrieval + Claude, grounded on live state)
  GET  /api/knowledge/search?q=         retrieval only
  POST /api/ingest                      MQTT-style IoT telemetry packet (ESP32 → LoRaWAN/GSM gateway → here)
  WS   /ws/telemetry                    broadcasts ingested packets to dashboards
  POST /api/datasets/generate?seed=     regenerate the bulk synthetic SQLite dataset
  GET  /api/datasets/summary            row counts
  GET  /api/datasets/{table}.csv        CSV export of a table
  GET  /api/readings?node_id=&limit=    time-series query
  POST /api/analytics/anomalies         robust anomaly detection on a series
  POST /api/analytics/forecast          demand forecast on a history
Everything served here is SIMULATED.

Run locally (repo root):  python -m uvicorn api.index:app --reload --port 8000
On Vercel this app is served by the api/index.py serverless function.
"""
from __future__ import annotations

import asyncio
import csv
import io
import sqlite3
from datetime import datetime, timezone
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from . import analytics, generator, rag
from .config import AUTO_GEN_DAYS, DB_PATH, MODEL, ON_VERCEL, llm_configured

app = FastAPI(title="JalNetra API (simulation)", version="1.0.0", description="Backend services for the JalNetra simulated water-governance platform. All data are synthetic.")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

PARAMS = ("ph", "tds", "turbidity", "chlorine", "orp", "flow", "pressure")
TABLES = ("districts", "villages", "nodes", "readings", "supply_daily", "health_weekly", "pipeline_daily")


def db() -> sqlite3.Connection:
    if not DB_PATH.exists():
        generator.generate(days=AUTO_GEN_DAYS)
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con


# ------------------------------------------------------------------ health
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "llm_configured": llm_configured(),
        "model": MODEL if llm_configured() else None,
        "db": DB_PATH.exists(),
        "websocket": not ON_VERCEL,  # serverless platforms cannot keep /ws/telemetry open
        "platform": "vercel" if ON_VERCEL else "server",
        "simulated": True,
        "time": datetime.now(timezone.utc).isoformat(),
    }


# ------------------------------------------------------------------ assistant
class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class AssistantRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    history: list[ChatTurn] = []
    context: dict = {}


@app.post("/api/assistant")
def assistant(req: AssistantRequest):
    try:
        return rag.answer(req.question, [t.model_dump() for t in req.history], req.context)
    except rag.LLMUnavailable as e:
        # 503 tells the browser to use its labelled local rule-based fallback.
        raise HTTPException(status_code=503, detail=str(e)) from e


@app.get("/api/knowledge/search")
def knowledge_search(q: str, k: int = 4):
    return {"query": q, "results": rag.retrieve(q, k)}


# ------------------------------------------------------------------ IoT ingestion
class Telemetry(BaseModel):
    """MQTT-compatible payload, e.g. published on jalnetra/<district>/<village>/<node>/telemetry."""

    node_id: str = Field(min_length=3, max_length=64, pattern=r"^[a-z0-9\-]+$")
    ts: str | None = None
    readings: dict[str, float]
    transport: Literal["LoRaWAN", "GSM", "NB-IoT", "MQTT", "HTTP"] = "LoRaWAN"
    rssi: float | None = None
    battery_v: float | None = None
    simulated: bool = True


class Hub:
    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.received = 0

    async def broadcast(self, msg: dict) -> None:
        dead = []
        for ws in self.clients:
            try:
                await ws.send_json(msg)
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.clients.discard(ws)


hub = Hub()

LIMITS = {"ph": (0, 14), "tds": (0, 10000), "turbidity": (0, 1000), "chlorine": (0, 20), "orp": (-500, 1200), "flow": (0, 100000), "pressure": (0, 30)}


@app.post("/api/ingest")
async def ingest(pkt: Telemetry):
    clean = {}
    for k, v in pkt.readings.items():
        if k not in PARAMS:
            raise HTTPException(422, f"unknown parameter {k}")
        lo, hi = LIMITS[k]
        if not lo <= v <= hi:
            raise HTTPException(422, f"{k}={v} outside plausible sensor range {lo}..{hi}")
        clean[k] = v
    ts = pkt.ts or datetime.now(timezone.utc).isoformat()
    con = db()
    row = {p: clean.get(p) for p in PARAMS}
    con.execute("INSERT INTO readings VALUES (?,?,?,?,?,?,?,?,?,?,?)", (pkt.node_id, ts, row["ph"], row["tds"], row["turbidity"], row["chlorine"], row["orp"], row["flow"], row["pressure"], f"ingest:{pkt.transport}", int(pkt.simulated)))
    con.commit()
    con.close()
    hub.received += 1
    msg = {"node_id": pkt.node_id, "ts": ts, "readings": clean, "transport": pkt.transport, "simulated": pkt.simulated}
    await hub.broadcast(msg)
    return {"accepted": True, "broadcast_to": len(hub.clients), "total_received": hub.received}


@app.websocket("/ws/telemetry")
async def ws_telemetry(ws: WebSocket):
    await ws.accept()
    hub.clients.add(ws)
    try:
        while True:
            await asyncio.wait_for(ws.receive_text(), timeout=3600)
    except (WebSocketDisconnect, asyncio.TimeoutError):
        pass
    finally:
        hub.clients.discard(ws)


# ------------------------------------------------------------------ datasets
@app.post("/api/datasets/generate")
def datasets_generate(seed: int = 20261119, days: int = Query(AUTO_GEN_DAYS, ge=1, le=60)):
    return generator.generate(seed, days)


@app.get("/api/datasets/summary")
def datasets_summary():
    con = db()
    out = {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in TABLES}  # noqa: S608 (fixed table list)
    meta = {r["key"]: r["value"] for r in con.execute("SELECT key, value FROM meta")}
    con.close()
    return {"counts": out, "meta": meta, "simulated": True}


@app.get("/api/datasets/{table}.csv")
def datasets_csv(table: str):
    if table not in TABLES:
        raise HTTPException(404, "unknown table")
    con = db()
    cur = con.execute(f"SELECT * FROM {table}")  # noqa: S608 (validated against TABLES)
    cols = [c[0] for c in cur.description]

    def rows():
        buf = io.StringIO()
        w = csv.writer(buf)
        buf.write("# SIMULATED DATA - JalNetra demonstration environment. Not government data.\n")
        w.writerow(cols)
        for r in cur:
            w.writerow(list(r))
            if buf.tell() > 65536:
                yield buf.getvalue()
                buf.seek(0)
                buf.truncate()
        yield buf.getvalue()
        con.close()

    return StreamingResponse(rows(), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="jalnetra_{table}_SIMULATED.csv"'})


@app.get("/api/readings")
def readings(node_id: str, limit: int = Query(96, ge=1, le=5000)):
    con = db()
    rows = [dict(r) for r in con.execute("SELECT * FROM readings WHERE node_id = ? ORDER BY ts DESC LIMIT ?", (node_id, limit))]
    con.close()
    return {"node_id": node_id, "rows": rows[::-1], "simulated": True}


# ------------------------------------------------------------------ analytics
class SeriesIn(BaseModel):
    values: list[float] = Field(min_length=5, max_length=20000)
    window: int = 24
    z: float = 4.0


@app.post("/api/analytics/anomalies")
def anomalies(body: SeriesIn):
    return analytics.detect_anomalies(body.values, body.window, body.z)


@app.get("/api/analytics/anomalies/{node_id}")
def anomalies_for_node(node_id: str, param: str = "chlorine", limit: int = 2880):
    if param not in PARAMS:
        raise HTTPException(422, "unknown parameter")
    con = db()
    vals = [r[0] for r in con.execute(f"SELECT {param} FROM readings WHERE node_id = ? AND {param} IS NOT NULL ORDER BY ts DESC LIMIT ?", (node_id, limit))][::-1]  # noqa: S608
    con.close()
    if len(vals) < 5:
        raise HTTPException(404, "not enough readings for this node")
    return {"node_id": node_id, "param": param, **analytics.detect_anomalies(vals)}


class HistoryPoint(BaseModel):
    demand: float
    temp: float
    rain: float
    weekday: int = Field(ge=0, le=6)


class ForecastIn(BaseModel):
    history: list[HistoryPoint] = Field(min_length=7)
    horizon: int = Field(30, ge=1, le=180)
    temperature: float | None = None
    rainfall: float | None = None


@app.post("/api/analytics/forecast")
def forecast(body: ForecastIn):
    return analytics.forecast_demand([h.model_dump() for h in body.history], body.horizon, body.temperature, body.rainfall)


@app.get("/api/analytics/forecast/{village_id}")
def forecast_village(village_id: str, horizon: int = 30):
    con = db()
    rows = list(con.execute("SELECT day, demand_kl, temp_c, rain_mm FROM supply_daily WHERE village_id = ? ORDER BY day", (village_id,)))
    con.close()
    if len(rows) < 7:
        raise HTTPException(404, "unknown village or not enough history")
    hist = [{"demand": r[1], "temp": r[2], "rain": r[3], "weekday": datetime.fromisoformat(r[0]).weekday()} for r in rows]
    return {"village_id": village_id, **analytics.forecast_demand(hist, horizon)}
