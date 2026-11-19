"""Simulated ESP32 sensor nodes publishing telemetry through a LoRaWAN/GSM gateway.

Each packet mirrors what a field device would send (MQTT topic shown for reference) and is
POSTed to the JalNetra backend's /api/ingest endpoint, which broadcasts it on /ws/telemetry.
Connect the dashboard via "Data & Simulation Controls → IoT ingestion gateway" to watch the
readings land on the matching nodes in real time.

Usage (from the backend/ folder, with the API running on :8000):
    python scripts/esp32_simulator.py                         # featured demo nodes, normal readings
    python scripts/esp32_simulator.py --event low-chlorine    # chlorinator failure on nlg-v1-tap1
    python scripts/esp32_simulator.py --nodes adb-v1-tap1,knr-v1-inlet --interval 2 --count 20

All packets are flagged simulated=true. Uses only the Python standard library.
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

BASE = {"ph": 7.4, "tds": 300, "turbidity": 0.6, "chlorine": 0.5, "flow": 100, "pressure": 1.2}
EVENTS = {
    "low-chlorine": {"chlorine": 0.05},
    "turbidity": {"turbidity": 12.0},
    "high-tds": {"tds": 1200},
    "low-flow": {"flow": 25, "pressure": 0.4},
    "acidic": {"ph": 5.8},
}


def packet(node: str, t: float, event: str | None, r: random.Random) -> dict:
    vals = dict(BASE)
    if event:
        vals.update(EVENTS[event])
    vals["chlorine"] *= 1 - 0.04 * math.sin(t / 600)
    noisy = {k: round(max(0.0, v + r.gauss(0, {"ph": 0.03, "tds": 4, "turbidity": 0.03, "chlorine": 0.01, "flow": 1.2, "pressure": 0.02}[k])), 3) for k, v in vals.items()}
    district, village = node.split("-")[0], "-".join(node.split("-")[:2])
    return {
        "node_id": node,
        "ts": datetime.now(timezone.utc).isoformat(),
        "readings": noisy,
        "transport": r.choice(["LoRaWAN", "GSM", "NB-IoT"]),
        "rssi": round(r.uniform(-118, -70), 1),
        "battery_v": round(r.uniform(3.6, 4.1), 2),
        "simulated": True,
        "_mqtt_topic": f"jalnetra/{district}/{village}/{node}/telemetry",
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--api", default="http://127.0.0.1:8000")
    ap.add_argument("--nodes", default="nlg-v1-tap1")
    ap.add_argument("--interval", type=float, default=3.0, help="seconds between packets (real devices: 900 s)")
    ap.add_argument("--count", type=int, default=0, help="packets per node (0 = run until Ctrl+C)")
    ap.add_argument("--event", choices=sorted(EVENTS), default=None)
    args = ap.parse_args()
    r = random.Random()
    nodes = [n.strip() for n in args.nodes.split(",") if n.strip()]
    sent = 0
    print(f"Publishing SIMULATED telemetry for {nodes} to {args.api}/api/ingest (event={args.event}) — Ctrl+C to stop")
    try:
        while args.count == 0 or sent < args.count * len(nodes):
            for n in nodes:
                p = packet(n, time.time(), args.event, r)
                topic = p.pop("_mqtt_topic")
                req = urllib.request.Request(f"{args.api}/api/ingest", data=json.dumps(p).encode(), headers={"Content-Type": "application/json"}, method="POST")
                try:
                    with urllib.request.urlopen(req, timeout=5) as resp:
                        res = json.loads(resp.read())
                    print(f"[{topic}] {p['readings']} -> broadcast to {res['broadcast_to']} dashboard(s)")
                except urllib.error.URLError as e:
                    print(f"[{topic}] send failed: {e}")
                sent += 1
            time.sleep(args.interval)
    except KeyboardInterrupt:
        pass
    print(f"Sent {sent} packets.")


if __name__ == "__main__":
    main()
