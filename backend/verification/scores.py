"""Forecast verification. FAR means false-alarm ratio, not false-positive rate."""
import numpy as np


def contingency(y, prediction, threshold=64.5):
    observed = np.asarray(y) >= threshold
    forecast = np.asarray(prediction) >= threshold
    h = int(np.sum(observed & forecast))
    m = int(np.sum(observed & ~forecast))
    f = int(np.sum(~observed & forecast))
    c = int(np.sum(~observed & ~forecast))
    n = h + m + f + c
    random_hits = (h + m) * (h + f) / n if n else 0
    def ratio(a, b):
        return float(a / b) if b else None
    return {"hits": h, "misses": m, "false_alarms": f, "correct_negatives": c,
            "pod": ratio(h, h + m), "far": ratio(f, h + f),
            "csi": ratio(h, h + m + f),
            "ets": ratio(h - random_hits, h + m + f - random_hits)}


def scores(y, prediction, probability=None, threshold=64.5):
    y, prediction = np.asarray(y), np.asarray(prediction)
    result = {"rmse": float(np.sqrt(np.mean((prediction - y) ** 2))),
              "bias": float(np.mean(prediction - y)), **contingency(y, prediction, threshold)}
    if probability is not None:
        event = (y >= threshold).astype(float)
        probability = np.asarray(probability)
        result["brier"] = float(np.mean((probability - event) ** 2))
        climatology = float(event.mean())
        ref = float(np.mean((climatology - event) ** 2))
        result["brier_skill"] = float(1 - result["brier"] / ref) if ref else None
    return result


def fss(observed, forecast, threshold=64.5, window=3):
    """Fractions skill score for a 2D grid; input cells share one spatial grid."""
    from scipy.ndimage import uniform_filter
    o = uniform_filter((np.asarray(observed) >= threshold).astype(float), size=window, mode="nearest")
    f = uniform_filter((np.asarray(forecast) >= threshold).astype(float), size=window, mode="nearest")
    denom = np.mean(o ** 2 + f ** 2)
    return float(1 - np.mean((o - f) ** 2) / denom) if denom else 1.0


def gate(y, raw, global_prediction, corrected, week, minimum_events=8, repetitions=100, seed=26080):
    """Paired week-block bootstrap: positive lower CI required for RMSE and CSI."""
    y, raw, global_prediction, corrected, week = map(np.asarray, (y, raw, global_prediction, corrected, week))
    events = int(np.sum(y >= 64.5))
    if events < minimum_events:
        return {"status": "Serving raw", "reason": f"Insufficient heavy-rain events ({events})", "events": events}
    rng = np.random.default_rng(seed)
    blocks = [np.flatnonzero(week == w) for w in np.unique(week)]
    differences = {"raw_rmse": [], "global_rmse": [], "raw_csi": [], "global_csi": []}
    for _ in range(repetitions):
        sampled = np.concatenate([blocks[i] for i in rng.integers(0, len(blocks), len(blocks))])
        yy = y[sampled]
        base = scores(yy, corrected[sampled])
        for name, reference in (("raw", raw), ("global", global_prediction)):
            compare = scores(yy, reference[sampled])
            differences[f"{name}_rmse"].append(compare["rmse"] - base["rmse"])
            differences[f"{name}_csi"].append((base["csi"] or 0) - (compare["csi"] or 0))
    ci = {key: [float(np.quantile(values, .025)), float(np.quantile(values, .975))] for key, values in differences.items()}
    failed = [key for key, value in ci.items() if value[0] <= 0]
    status = "Corrected" if not failed else "Serving raw"
    reason = "Improved RMSE and CSI over both baselines with positive 95% intervals" if not failed else "No verified improvement in " + ", ".join(failed)
    return {"status": status, "reason": reason, "events": events, "confidence_intervals": ci}
