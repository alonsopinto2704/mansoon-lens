"""Numpy-only inference for serverless hosts (Vercel): the trained LightGBM trees and logistic
calibrators are exported to JSON by `export_models`, then evaluated here without lightgbm, scipy,
scikit-learn or pandas. `tests/test_lite.py` checks parity with `backend.pipeline.serve.predict`.
"""
import numpy as np

REGIMES = ["Active", "Break", "Depression", "Orographic", "Coastal", "Western disturbance"]
THRESHOLDS = [64.5, 115.6, 204.5]
_MISSING = {"None": 0, "Zero": 1, "NaN": 2}


# ---------- export (runs where lightgbm is installed) ----------

def _flatten(structure):
    """Tree dict -> parallel lists. Children >= 0 are internal nodes, children < 0 are ~leaf_index."""
    feat, thr, dleft, miss, left, right, leaves = [], [], [], [], [], [], []

    def visit(node):
        if "leaf_value" in node:
            leaves.append(node["leaf_value"])
            return ~(len(leaves) - 1)
        i = len(feat)
        feat.append(node["split_feature"]); thr.append(node["threshold"]); dleft.append(int(node["default_left"]))
        miss.append(_MISSING[node["missing_type"]]); left.append(0); right.append(0)
        left[i], right[i] = visit(node["left_child"]), visit(node["right_child"])
        return i

    visit(structure)
    return {"f": feat, "t": thr, "d": dleft, "m": miss, "l": left, "r": right, "v": leaves}


def _booster(model):
    dump = model.booster_.dump_model()
    return {"num_class": dump["num_class"], "trees": [_flatten(t["tree_structure"]) for t in dump["tree_info"]]}


def _logistic(model):
    return [float(model.coef_[0][0]), float(model.intercept_[0])]


def export_models(saved: dict) -> dict:
    return {
        "classifier": _booster(saved["classifier"]),
        "calibrators": [_logistic(m) for m in saved["calibrators"]],
        "regime": [[_booster(m) for m in group] for group in saved["regime"]],
        "exceedance": [_booster(m) for m in saved["exceedance"]],
        "exceedance_calibrators": [_logistic(m) for m in saved["exceedance_calibrators"]],
        "active_offset_mm": float(saved.get("active_offset_mm", 0.0)),
    }


# ---------- evaluation (numpy only) ----------

def _tree(t, x):
    if not t["f"]:
        return np.full(len(x), t["v"][0])
    f, thr, dleft, miss = (np.asarray(t[k]) for k in "ftdm")
    left, right, value = np.asarray(t["l"]), np.asarray(t["r"]), np.asarray(t["v"])
    out = np.empty(len(x))
    rows = np.arange(len(x))
    node = np.zeros(len(x), dtype=int)
    while rows.size:
        n = node
        v = x[rows, f[n]]
        missing = ((miss[n] == 1) & ((np.abs(v) <= 1e-35) | np.isnan(v))) | ((miss[n] == 2) & np.isnan(v))
        v = np.where(np.isnan(v) & (miss[n] == 0), 0.0, v)  # LightGBM maps NaN to 0 when missing_type is None
        nxt = np.where(np.where(missing, dleft[n] == 1, v <= thr[n]), left[n], right[n])
        leaf = nxt < 0
        out[rows[leaf]] = value[~nxt[leaf]]
        rows, node = rows[~leaf], nxt[~leaf]
    return out


def _raw(booster, x):
    k = booster["num_class"]
    score = np.zeros((len(x), k))
    for i, t in enumerate(booster["trees"]):
        score[:, i % k] += _tree(t, x)
    return score if k > 1 else score[:, 0]


def _sigmoid(z):
    return 1 / (1 + np.exp(-z))


def _softmax(z):
    e = np.exp(z - z.max(axis=1, keepdims=True))
    return e / e.sum(axis=1, keepdims=True)


def predict(x: np.ndarray, models: dict, gate: dict) -> dict:
    """Same outputs as serve.predict for a (rows × FEATURES) float array."""
    x = np.asarray(x, dtype=float)
    raw_p = _softmax(_raw(models["classifier"], x))
    p = np.stack([_sigmoid(a * raw_p[:, r] + b) for r, (a, b) in enumerate(models["calibrators"])], axis=1)
    p /= p.sum(axis=1, keepdims=True)
    q = np.stack([np.sort(np.stack([np.maximum(0, _raw(m, x)) for m in group], axis=1), axis=1) for group in models["regime"]], axis=1)
    blend = np.sort(np.maximum(0, np.sum(q * p[:, :, None], axis=1) + models["active_offset_mm"] * p[:, 0, None]), axis=1)
    features = np.hstack([x, p])
    exceed = np.stack([_sigmoid(a * _sigmoid(_raw(m, features)) + b) for m, (a, b) in zip(models["exceedance"], models["exceedance_calibrators"])], axis=1)
    dominant = [REGIMES[r] for r in np.argmax(p, axis=1)]
    status = np.array([gate[name]["status"] for name in dominant])
    out = {"dominant_regime": dominant, "gate_status": status.tolist(), "raw_mm": x[:, 0],
           "corrected_p10": blend[:, 0], "corrected_p50": blend[:, 1], "corrected_p90": blend[:, 2],
           "served_mm": np.where(status == "Corrected", blend[:, 1], x[:, 0])}
    for j, t in enumerate(THRESHOLDS):
        out[f"prob_{str(t).replace('.', '_')}"] = exceed[:, j]
    for r in range(len(REGIMES)):
        out[f"regime_{r}"] = p[:, r]
    return out
