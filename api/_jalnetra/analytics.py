"""Python analytics: anomaly detection and demand forecasting (illustrative, dependency-free).

- Robust anomaly detection: rolling median / MAD z-scores + EWMA drift + flat-line (stuck sensor)
  detection, suitable for 15-minute IoT telemetry.
- Demand forecasting: OLS on temperature, rainfall and weekday with Holt's linear trend on residuals.
These are prototypes on synthetic data, not validated production models.
"""
from __future__ import annotations

import math
import statistics as st


def detect_anomalies(values: list[float], window: int = 24, z: float = 4.0, ewma_alpha: float = 0.1, drift_sigma: float = 3.0) -> dict:
    n = len(values)
    spikes, drifts, flat = [], [], []
    ewma = values[0] if values else 0.0
    base_sd = st.pstdev(values[: min(n, window * 4)]) if n > 2 else 0.0
    run = 1
    for i, v in enumerate(values):
        lo = max(0, i - window)
        ref = values[lo:i] or [v]
        med = st.median(ref)
        mad = st.median([abs(x - med) for x in ref]) or 1e-9
        rz = 0.6745 * (v - med) / mad
        if i >= 4 and abs(rz) > z:
            spikes.append({"index": i, "value": v, "robust_z": round(rz, 2)})
        ewma = ewma_alpha * v + (1 - ewma_alpha) * ewma
        if base_sd and i > window and abs(ewma - st.mean(values[:window])) > drift_sigma * base_sd * math.sqrt(ewma_alpha / (2 - ewma_alpha)):
            drifts.append(i)
        run = run + 1 if i and v == values[i - 1] else 1
        if run == 12:  # 3 hours identical at 15-min cadence
            flat.append(i)
    return {
        "n": n,
        "spikes": spikes[:200],
        "drift_onset": drifts[0] if drifts else None,
        "drift_points": len(drifts),
        "flatline_at": flat,
        "method": "rolling median/MAD robust z-score, EWMA drift, flat-line detector",
    }


def _ols(X: list[list[float]], y: list[float], lam: float = 0.5) -> list[float]:
    k = len(X[0])
    A = [[0.0] * k for _ in range(k)]
    b = [0.0] * k
    for row, t in zip(X, y):
        for i in range(k):
            b[i] += row[i] * t
            for j in range(k):
                A[i][j] += row[i] * row[j]
    for i in range(1, k):
        A[i][i] += lam
    # Gauss-Jordan
    M = [A[i] + [b[i]] for i in range(k)]
    for c in range(k):
        p = max(range(c, k), key=lambda r: abs(M[r][c]))
        M[c], M[p] = M[p], M[c]
        d = M[c][c] or 1e-9
        for r in range(k):
            if r != c:
                f = M[r][c] / d
                M[r] = [M[r][j] - f * M[c][j] for j in range(k + 1)]
    return [M[i][k] / (M[i][i] or 1e-9) for i in range(k)]


def forecast_demand(history: list[dict], horizon: int = 30, temperature: float | None = None, rainfall: float | None = None) -> dict:
    """history: [{"demand": kL, "temp": °C, "rain": mm, "weekday": 0-6}] (oldest first)."""
    X = [[1.0, h["temp"] - 30, min(h["rain"], 30), 1.0 if h["weekday"] == 6 else 0.0] for h in history]
    y = [h["demand"] for h in history]
    beta = _ols(X, y)
    fitted = [sum(a * c for a, c in zip(x, beta)) for x in X]
    resid = [a - f for a, f in zip(y, fitted)]
    # Holt's linear trend on residuals
    alpha, b_ = 0.3, 0.1
    level, trend = resid[0], 0.0
    for r in resid[1:]:
        prev = level
        level = alpha * r + (1 - alpha) * (level + trend)
        trend = b_ * (level - prev) + (1 - b_) * trend
    sd = st.pstdev(resid) if len(resid) > 1 else 0.0
    T = temperature if temperature is not None else st.mean(h["temp"] for h in history)
    R = rainfall if rainfall is not None else st.mean(h["rain"] for h in history)
    last_wd = history[-1]["weekday"]
    out = []
    for k in range(1, horizon + 1):
        wd = (last_wd + k) % 7
        base = beta[0] + beta[1] * (T - 30) + beta[2] * min(R, 30) + beta[3] * (1 if wd == 6 else 0)
        f = base + level + trend * k
        out.append({"day": k, "demand": round(f, 2), "lo": round(f - 1.96 * sd, 2), "hi": round(f + 1.96 * sd, 2)})
    mape = st.mean(abs(r) / max(1e-9, a) for r, a in zip(resid, y)) * 100 if y else 0.0
    return {"coefficients": [round(c, 4) for c in beta], "in_sample_mape_pct": round(mape, 2), "forecast": out, "model": "OLS(temp, rain, sunday) + Holt trend on residuals (illustrative)"}
