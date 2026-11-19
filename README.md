# JalNetra — AI-Powered IoT Virtual Water Grid for Telangana (prototype)

> “From Infrastructure Creation to Intelligent Water Governance — Every Drop Monitored, Every Village Accounted For.”

JalNetra is a working, fully interactive **simulation** of a state-level rural drinking-water command centre in the style of Mission Bhagiratha. You can change a sensor reading, a population figure, a supply value or a threshold, and the whole application recalculates: map markers, pipeline colours, KPIs, charts, alerts, the health early-warning, equity rankings, forecasts and the AI assistant's answers.

> ⚠️ **All data are synthetic.** District names, approximate HQ coordinates, mandal names and the named reservoirs are real. Everything else is simulated: villages, sensors, readings, health records, alerts, treatment plants, service reservoirs and every pipeline alignment. Nothing here is government data or real-time Mission Bhagiratha data. Notifications are in-app simulations; no SMS or WhatsApp is ever sent.

---

## Quick start (local)

**Requirements:** Node.js 18+ (tested on 22), Python 3.10+. Run everything from the repo root.

```bash
# 1) The app — the whole simulation runs in the browser
npm install
npm run dev                                   # → http://localhost:5173

# 2) Optional backend — LLM assistant, IoT ingestion, SQLite dataset, Python analytics
python -m pip install -r requirements.txt
python -m uvicorn api.index:app --port 8000   # same FastAPI app Vercel runs as a function
#   For LLM answers, set ANTHROPIC_API_KEY before starting (model: claude-opus-5-5;
#   override with JALNETRA_MODEL). Without a key the assistant uses its labelled local fallback.

# 3) Optional — simulated ESP32 devices publishing telemetry
python scripts/esp32_simulator.py --event low-chlorine
#   then in the app: Data & Simulation Controls → IoT ingestion gateway → Connect
```

The Vite dev server proxies `/api` and `/ws` to `localhost:8000`. The top bar shows `API offline · browser engine` when the backend is not running, and everything still works.

**Basemap:** the map uses keyless Esri / OpenStreetMap tiles, which need internet access. Offline, choose *Basemap: None*; all markers, pipelines and interactions still work.

**Tests:** `npm run test:engine` runs the headless end-to-end engine test (the 12-step chlorine demo plus turbidity, TDS, pH, flow and pressure, water balance, equity, forecast and assistant checks).

---

## Deploy on Vercel (single project)

The repository is **one Vercel project**: the root is a Vite app, and `api/index.py` is its Python serverless function. There's no separate backend service to deploy.

1. In Vercel, **Add New → Project → Import** this repository. Vercel should detect a single **Vite** project at the root (`vercel.json` also pins `"framework": "vite"`). Keep *Root Directory* as `./` and the default settings.
2. *(Optional)* Under **Environment Variables**, add `ANTHROPIC_API_KEY` to enable LLM answers. `JALNETRA_MODEL` overrides the model (default `claude-opus-5-5`).
3. Click **Deploy**. Static files come from `dist/` on the CDN, and every `/api/*` request is rewritten to the FastAPI function (`api/index.py` → `api/_jalnetra/`).

What differs on Vercel:
- **Live WebSocket ingestion (`/ws/telemetry`) is unavailable**, because serverless functions cannot keep connections open. `POST /api/ingest` still validates and stores packets, and the dashboard shows the streaming button as unavailable with an explanation.
- **SQLite lives in `/tmp`** and is regenerated (7 days of 15-minute history, about 1–2 s) on a cold start. Nothing persists between function instances.
- Everything else (the full simulation, map, alerts, lab, reports, assistant, CSV/PDF export) behaves exactly as it does locally.

---

## The end-to-end demonstration (no page refresh)

1. Open **2. Telangana Virtual Water Grid** → **Open demo village**. This is a Nalgonda habitation whose tap node starts at FRC 0.50 mg/L.
2. In the sensor panel, drag **FRC** to **0.05 mg/L**, or type it.
3. Immediately: a critical *Low residual chlorine* alert and toast appear, the marker turns red and pulses, the risk score jumps to about 82, and the health surveillance priority rises onto the watch list. The panel shows the explanation, the BIS reference and corrective actions.
4. Click **Ask AI** and the assistant explains why the village is red, using the live data.
5. Click **Restore node baseline** and the alert auto-resolves (shown in the panel, the toast and the Alert Centre history).
6. Repeat with turbidity (15 NTU), TDS (1,200 mg/L, a warning rather than toxicity), pH, flow (25 L/min) and pressure.

---

## What's in each section

| # | Section | Highlights |
|---|---|---|
| 1 | Executive Command Centre | 10 live KPI cards; 7 charts (quality by district, supply trend, demand vs supply, risk trend, village LPCD, pipeline loss, equity ranking); district / mandal / village / date / severity filters |
| 2 | Telangana Virtual Water Grid | Leaflet GIS: 33 district hubs, 13 real reservoirs, illustrative WTPs and service reservoirs, ~320 colour-coded pipeline segments (intake, transmission, distribution, service) with animated flow, 130 villages, 274 sensor nodes; layers for quality, supply, health and equity; search; district and village panels |
| 3 | Live Water Quality Monitoring | Per-village sensor panel (2–3 nodes) with sliders for TDS, turbidity, FRC, pH, flow and pressure; ORP is derived; 24 h / 7 d / 30 d trends from 15-minute history; change log |
| 4 | AI Water Demand Forecasting | Per-village OLS model fitted on 30-day history; 7-day, 30-day and 6-month outputs; actual vs fit vs forecast with a 95% band; backtest MAPE; inputs for population, LPCD, rainfall, temperature and capacity; shortage list |
| 5 | Pipeline Integrity & Leakage | Water balance `upstream − downstream − authorised`; classifies suspected leakage, possible unauthorised draw-off, measurement uncertainty and upstream disruption (never "theft"); editable meters; event injection; reservoir in/out balance |
| 6 | Waterborne Disease Early Warning | Synthetic anonymised surveillance (13 weeks); priority score = 0.5 water + 0.35 case trend + 0.15 supply stress; PUBLIC HEALTH WATCH card; correlation engine (Pearson r); explicit no-diagnosis / no-causation framing |
| 7 | Water Equity Intelligence | Editable population and supply; LPCD, gap, % fulfilled, equity score, Gini; district ranking; priority intervention list; the A–E worked example as a live sandbox |
| 8 | JalNetra AI Assistant | RAG: BM25 over an 18-document knowledge base plus a live-state snapshot. Uses Claude through the backend when configured; otherwise a functional, clearly labelled local rule-based engine. Downloadable summary |
| 9 | Water Intelligence Lab | 6 sliders on the spec's ranges; beginner and advanced modes; 7 scenarios; before/after table; guided experiments with auto-check; 8-question quiz; training score; **link to a real simulated village** so lab changes hit the map and KPIs |
| 10 | Reports & Policy Insights | Village / mandal / district / state reports in CSV and PDF; live policy insights (underserved villages, quality-risk districts, losses, investment, inspection priorities) |
| — | Alert & Notification Centre | Data-driven alerts across 7 categories, with previous → new value, timestamps, timeline, acknowledgement, filters, CSV export and opt-in browser notifications |
| — | Data & Simulation Controls | Generate or reset the dataset (seeded), inject and resolve 9 abnormal-event types, CSV import and export, clock speed and pause, all thresholds configurable, IoT ingestion connection |

---

## Architecture

```
/ (repo root = the Vercel project)
  index.html, package.json, vite.config.ts, tailwind.config.js, tsconfig.json
  vercel.json            Vite build → dist/, /api/* → api/index.py
  requirements.txt       Python deps for the serverless function
  src/                   React 18 + TypeScript + Tailwind + Recharts + Leaflet + zustand
    engine/                the simulation engine (pure TypeScript, unit-testable)
      generator.ts           synthetic data: districts → villages → nodes, segments, 30-d supply, 13-wk health
      sim.ts                 15-min physics tick, user overrides, reversible abnormal events
      compute.ts             derived layer: risk, LPCD, equity, Gini, water balance + loss classifier, health
      alerts.ts              condition builder + alert diff (raise / escalate / auto-resolve)
      forecast.ts            per-village OLS demand model with backtest
      history.ts             deterministic 15-min × 30-day sensor history per node (lazy)
      thresholds.ts          BIS IS 10500 + operational thresholds, parameter knowledge, ORP coupling
      assistant.ts           BM25 retrieval, live-state intent handlers, LLM context builder
    store.ts               single store; every mutation → recompute → alert diff → notifications
    data/                  knowledge_base.json, telangana_geo.json (also read by the Python backend)
  api/
    index.py             Vercel function entry (exports the FastAPI `app`)
    _jalnetra/           backend package (underscore = not a separate function)
      main.py              REST + WebSocket: /api/health, /api/assistant, /api/ingest, /ws/telemetry,
                           /api/datasets/*, /api/readings, /api/analytics/{anomalies,forecast}
      rag.py               BM25 retrieval + Claude (Anthropic SDK; refusal fallback; prompt caching)
      generator.py         bulk synthetic dataset → SQLite
      analytics.py         robust MAD/EWMA/flat-line anomaly detection; OLS + Holt demand forecast
  scripts/
    engine-test.ts       headless engine test (npm run test:engine)
    esp32_simulator.py   ESP32 / LoRaWAN / GSM device emulator (MQTT-style topics, HTTP POST)
```

**Why the engine runs in the browser:** every interaction must recalculate instantly without a page refresh, and the app must still be demonstrable with no server. The backend adds the parts that need a server (LLM calls, device ingestion, bulk storage, Python analytics). Its modules are separate so real IoT feeds (MQTT broker → `/api/ingest`) and verified datasets (PostGIS) can be added later.

**Integrating real devices:** publish packets as `{"node_id": "nlg-v1-tap1", "readings": {"chlorine": 0.42, ...}, "transport": "LoRaWAN"}` to `POST /api/ingest`. Node IDs follow `<district>-v<n>-{inlet|ohsr|tap1}`.

---

## Known limitations (by design for a prototype)

- **Synthetic everything.** The relationships are realistic (turbidity ↔ chlorine demand ↔ ORP, flow ↔ LPCD, population ↔ demand, loss ↔ downstream deficit, quality ↔ case incidence), but no value describes a real place.
- **Village positions are illustrative points** near each real district HQ. Village names are synthetic.
- **Pipelines are schematic straight links.** They are not Mission Bhagiratha alignments, and the assignment of sources to districts is illustrative.
- **The forecasting model is illustrative** (OLS on synthetic history) and is not validated for operational planning.
- **The health score is a prioritisation aid.** It does not diagnose disease, confirm an outbreak or establish causation.
- **Sensor values are not laboratory measurements.** Every recommended action starts with confirmatory testing.
- **The backend generator uses its own RNG.** Its SQLite dataset shares geography and IDs with the browser twin, but not its exact values. The browser is the authoritative live state.
- **No SMS or WhatsApp gateway** is integrated. The Alert Centre shows both as "Not configured".
- **State lives in memory.** Reloading the page resets the simulation (the same seed regenerates the same dataset).
