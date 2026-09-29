"""Apply the saved models to new predictor rows (CSV upload and the live NWP feed)."""
import numpy as np
import pandas as pd

from backend.data.generate_synthetic import REGIMES
from backend.pipeline.train import FEATURES, THRESHOLDS, with_regimes


def predict(numeric: pd.DataFrame, saved: dict, gate: dict) -> pd.DataFrame:
    """Regime probabilities, blended P10/best/P90, gated served value and exceedance chances per row."""
    x = numeric[FEATURES]
    raw_p = saved["classifier"].predict_proba(x)
    p = np.stack([m.predict_proba(raw_p[:, r:r+1])[:, 1] for r, m in enumerate(saved["calibrators"])], axis=1)
    p /= p.sum(axis=1, keepdims=True)
    q = np.stack([np.sort(np.stack([np.maximum(0, model.predict(x)) for model in group], axis=1), axis=1) for group in saved["regime"]], axis=1)
    blend = np.sort(np.maximum(0, np.sum(q * p[:, :, None], axis=1) + saved.get("active_offset_mm", 0.0) * p[:, 0, None]), axis=1)
    features = with_regimes(x, p)
    exceed = np.stack([cal.predict_proba(model.predict_proba(features)[:, 1].reshape(-1, 1))[:, 1] for model, cal in zip(saved["exceedance"], saved["exceedance_calibrators"])], axis=1)
    dominant = [REGIMES[r] for r in np.argmax(p, axis=1)]
    status = [gate[name]["status"] for name in dominant]
    raw = x.raw_mm.to_numpy(dtype=float)
    out = pd.DataFrame({
        "dominant_regime": dominant, "gate_status": status, "raw_mm": raw,
        "corrected_p10": blend[:, 0], "corrected_p50": blend[:, 1], "corrected_p90": blend[:, 2],
        "served_mm": np.where(np.array(status) == "Corrected", blend[:, 1], raw),
    }, index=numeric.index)
    for j, t in enumerate(THRESHOLDS):
        out[f"prob_{str(t).replace('.', '_')}"] = exceed[:, j]
    for r, name in enumerate(REGIMES):
        out[f"regime_{r}"] = p[:, r]
    return out
