"""Bulk synthetic dataset generator (Python) -> SQLite time-series store.

Produces the "historical" side of the demonstration environment for analytics, export and
backend experiments. It uses the same geography file and ID scheme as the browser engine
(`<district>-v<n>` villages, `<village>-inlet|ohsr|tap1` nodes) so packets and queries line up,
but it uses its own RNG, so values differ from the in-browser twin, which remains the
authoritative live state for interactive use. Every row carries simulated = 1.

Contents per run: 33 districts, ~130 villages, 2-3 nodes per village, 15-minute readings for
30 days on demonstration-village nodes, 30-day daily supply for all villages, 13 weeks of
weekly health surveillance, and daily pipeline flow balance per distribution segment.
"""
from __future__ import annotations

import json
import math
import random
import sqlite3
from datetime import datetime, timedelta

from .config import DB_PATH, GEO_PATH

SCHEMA = """
DROP TABLE IF EXISTS districts; DROP TABLE IF EXISTS villages; DROP TABLE IF EXISTS nodes;
DROP TABLE IF EXISTS readings; DROP TABLE IF EXISTS supply_daily; DROP TABLE IF EXISTS health_weekly;
DROP TABLE IF EXISTS pipeline_daily; DROP TABLE IF EXISTS meta;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE districts (id TEXT PRIMARY KEY, name TEXT, lat REAL, lng REAL, source_id TEXT, simulated INTEGER);
CREATE TABLE villages (id TEXT PRIMARY KEY, name TEXT, mandal TEXT, district_id TEXT, lat REAL, lng REAL, population INTEGER, supply_hours INTEGER, demo INTEGER, simulated INTEGER);
CREATE TABLE nodes (id TEXT PRIMARY KEY, village_id TEXT, kind TEXT, transport TEXT, simulated INTEGER);
CREATE TABLE readings (node_id TEXT, ts TEXT, ph REAL, tds REAL, turbidity REAL, chlorine REAL, orp REAL, flow REAL, pressure REAL, source TEXT, simulated INTEGER);
CREATE INDEX idx_readings_node_ts ON readings(node_id, ts);
CREATE TABLE supply_daily (village_id TEXT, day TEXT, supplied_kl REAL, demand_kl REAL, interrupted INTEGER, temp_c REAL, rain_mm REAL, simulated INTEGER);
CREATE TABLE health_weekly (village_id TEXT, week_start TEXT, suspected_diarrhoea INTEGER, suspected_typhoid INTEGER, suspected_cholera INTEGER, gi_symptoms INTEGER, population INTEGER, water_risk REAL, simulated INTEGER);
CREATE TABLE pipeline_daily (segment_id TEXT, day TEXT, upstream_kl REAL, downstream_kl REAL, authorised_kl REAL, loss_pct REAL, simulated INTEGER);
"""

STEMS = ["Rama", "Gopal", "Laxmi", "Venkata", "Sita", "Konda", "Pedda", "Chinna", "Nalla", "Erra", "Malla", "Bhima", "Ananta", "Siri", "Kotha", "Mamidi", "Tummala", "Nara", "Chandra", "Surya"]
SUFFIX = ["puram", "pally", "gudem", "pet", "nagar", "wada", "thanda", "palem", "guda", "kunta"]
CLIMATE_T = [30, 33, 36, 39, 41, 36, 31, 30, 31, 31, 30, 29]
CLIMATE_R = [0.2, 0.3, 0.5, 0.8, 1.0, 4.0, 7.0, 7.5, 5.5, 3.0, 0.9, 0.3]


def orp_from(cl: float, ph: float, turb: float) -> float:
    return max(80.0, min(880.0, 340 + 300 * math.log10(1 + 8 * max(0.0, cl)) - 40 * (ph - 7) - 4 * turb))


def poisson(r: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    L, k, p = math.exp(-lam), 0, 1.0
    while True:
        k += 1
        p *= r.random()
        if p <= L:
            return k - 1


def generate(seed: int = 20261119, days: int = 30) -> dict:
    r = random.Random(seed)
    geo = json.loads(GEO_PATH.read_text(encoding="utf-8"))
    now = datetime.now().replace(minute=0, second=0, microsecond=0, hour=6)
    con = sqlite3.connect(DB_PATH)
    con.executescript(SCHEMA)
    con.execute("INSERT INTO meta VALUES ('seed', ?), ('generated_at', ?), ('note', 'SIMULATED DATA - not government data')", (str(seed), datetime.now().isoformat()))
    counts = {"districts": 0, "villages": 0, "nodes": 0, "readings": 0, "supply_daily": 0, "health_weekly": 0, "pipeline_daily": 0}
    used: set[str] = set()

    for d in geo["districts"]:
        con.execute("INSERT INTO districts VALUES (?,?,?,?,?,1)", (d["id"], d["name"], d["lat"], d["lng"], d["sourceId"]))
        counts["districts"] += 1
        n_v = 2 if d["id"] == "hyd" else len(d["mandals"])
        tds_base = r.uniform(180, 430)
        for i in range(n_v):
            vid = f"{d['id']}-v{i + 1}"
            while True:
                name = r.choice(STEMS) + r.choice(SUFFIX)
                if name not in used:
                    used.add(name)
                    break
            ang = 2 * math.pi * i / n_v + r.uniform(-0.35, 0.35)
            rad = r.uniform(0.1, 0.24)
            pop = int(round(math.exp(r.uniform(math.log(1600), math.log(12500))), -1))
            lpcd = r.uniform(86, 118) if r.random() < 0.8 else (r.uniform(52, 74) if r.random() < 0.65 else r.uniform(24, 38))
            hours = r.randint(16, 24) if lpcd > 75 else r.randint(6, 14)
            demo = i == 0
            con.execute("INSERT INTO villages VALUES (?,?,?,?,?,?,?,?,?,1)", (vid, name, d["mandals"][i % len(d["mandals"])], d["id"], d["lat"] + rad * math.sin(ang), d["lng"] + rad * 1.1 * math.cos(ang), pop, hours, int(demo)))
            counts["villages"] += 1
            inlet_flow = pop * lpcd / (hours * 60)
            kinds = ["inlet", "ohsr", "tap1"] if demo else ["inlet", "tap1"]
            for k in kinds:
                nid = f"{vid}-{k}"
                con.execute("INSERT INTO nodes VALUES (?,?,?,?,1)", (nid, vid, k, r.choice(["LoRaWAN", "GSM", "NB-IoT"])))
                counts["nodes"] += 1
                if not demo:
                    continue
                # 15-minute readings for demonstration-village nodes
                cl0 = {"inlet": 0.78, "ohsr": 0.62, "tap1": 0.45}[k]
                flow0 = inlet_flow if k != "tap1" else r.uniform(45, 120)
                pr0 = {"inlet": 2.2, "ohsr": 1.5, "tap1": 1.2}[k]
                cur = {"ph": 7.4, "tds": tds_base, "turbidity": 0.5, "chlorine": cl0, "flow": flow0, "pressure": pr0}
                rows = []
                event_at = r.randint(200, days * 96 - 200) if r.random() < 0.3 else -1
                for s in range(days * 96):
                    ts = now - timedelta(minutes=15 * (days * 96 - s))
                    h = ts.hour + ts.minute / 60
                    tgt = {"ph": 7.4, "tds": tds_base, "turbidity": 0.5, "chlorine": cl0 * (1 - 0.04 * math.sin(2 * math.pi * (h - 14) / 24)), "flow": flow0 * (1 + 0.05 * math.sin(2 * math.pi * (h - 8) / 12)), "pressure": pr0}
                    if event_at >= 0 and event_at <= s < event_at + 40:  # transient chlorination dip
                        tgt["chlorine"] *= 0.2
                    for p, sd in (("ph", 0.03), ("tds", 4), ("turbidity", 0.03), ("chlorine", 0.012), ("flow", 0.012 * flow0), ("pressure", 0.015 * pr0)):
                        cur[p] = max(0.0, cur[p] + 0.4 * (tgt[p] - cur[p]) + r.gauss(0, sd))
                    rows.append((nid, ts.isoformat(), round(cur["ph"], 2), round(cur["tds"]), round(cur["turbidity"], 2), round(cur["chlorine"], 3), round(orp_from(cur["chlorine"], cur["ph"], cur["turbidity"])), round(cur["flow"], 1), round(cur["pressure"], 2), "generator", 1))
                con.executemany("INSERT INTO readings VALUES (?,?,?,?,?,?,?,?,?,?,?)", rows)
                counts["readings"] += len(rows)

            # Daily supply, pipeline balance
            base_kl = inlet_flow * hours * 60 / 1000
            reliability = 0.95 if lpcd > 75 else 0.8
            base_loss = r.uniform(0.015, 0.045)
            for k in range(days, 0, -1):
                day = now - timedelta(days=k)
                T = CLIMATE_T[day.month - 1] + r.gauss(0, 1.6)
                R = -math.log(1 - r.random()) * CLIMATE_R[day.month - 1] * 2.5 if r.random() < 0.25 else 0.0
                interrupted = r.random() > reliability
                supplied = base_kl * (r.uniform(0.2, 0.6) if interrupted else r.uniform(0.94, 1.05))
                demand = pop * 100 / 1000 * (1 + 0.012 * (T - 30)) * (1 - 0.008 * min(R, 25)) + pop * 0.004 + r.gauss(0, pop * 0.002)
                con.execute("INSERT INTO supply_daily VALUES (?,?,?,?,?,?,?,1)", (vid, day.date().isoformat(), round(supplied, 1), round(demand, 1), int(interrupted), round(T, 1), round(R, 1)))
                up = supplied / (1 - 0.02 - base_loss)
                loss = base_loss + r.gauss(0, 0.01)
                con.execute("INSERT INTO pipeline_daily VALUES (?,?,?,?,?,?,1)", (f"seg-d-{vid}", day.date().isoformat(), round(up, 1), round(up * (1 - 0.02 - loss), 1), round(up * 0.02, 1), round(loss * 100, 2)))
                counts["supply_daily"] += 1
                counts["pipeline_daily"] += 1
            # Weekly health surveillance (13 weeks)
            rate = r.uniform(4, 10)
            for w in range(13):
                ws = now - timedelta(days=7 * (12 - w) + now.weekday())
                lam = pop / 10000 * rate * (1 + 0.35 * max(0, (6 - w) / 6))
                dia = poisson(r, lam)
                con.execute("INSERT INTO health_weekly VALUES (?,?,?,?,?,?,?,?,1)", (vid, ws.date().isoformat(), dia, poisson(r, pop / 10000 * 0.6), poisson(r, pop / 10000 * 0.015), dia + poisson(r, lam * 0.9), pop, round(max(0, 9 + r.gauss(0, 3)), 1)))
                counts["health_weekly"] += 1
    con.commit()
    con.close()
    return {"seed": seed, "db": str(DB_PATH), "counts": counts, "simulated": True}


if __name__ == "__main__":
    print(json.dumps(generate(), indent=2))
