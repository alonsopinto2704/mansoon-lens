"""Live raw NWP rainfall for every district from Open-Meteo, run through the trained correction.

Open-Meteo (https://open-meteo.com, CC BY 4.0, free non-commercial tier) serves its best-match global
NWP forecast. Rain days are 00–24 IST calendar days, not the IMD 08:30 IST rain day. The models were
trained on the synthetic sample, so live corrected values are unverified illustrations of the pipeline.
"""
from datetime import datetime, timezone
import json
import os
import threading
import time
import urllib.parse
import urllib.request

import numpy as np
import pandas as pd

from backend.data.generate_synthetic import DATA

URL = "https://api.open-meteo.com/v1/forecast"
DAILY = ["precipitation_sum", "wind_speed_10m_max", "relative_humidity_2m_mean", "pressure_msl_mean"]
CACHE = DATA / "live.json"
MAX_AGE_S = 3 * 3600
BATCH = 100
PAUSE_S = 11  # ponytail: fixed pacing keeps 781 locations under the free tier's ~600 calls/minute
RETRY_S = 600  # after a failed refresh, wait before spending the API quota again
_lock = threading.Lock()
_state = {"status": "idle", "error": None}
_failed_at = 0.0
_memo = {"mtime": None, "data": None}


def _fetch_batch(lats, lons):
    query = urllib.parse.urlencode({"latitude": ",".join(f"{v:.3f}" for v in lats), "longitude": ",".join(f"{v:.3f}" for v in lons),
                                    "daily": ",".join(DAILY), "timezone": "Asia/Kolkata", "forecast_days": 6})
    with urllib.request.urlopen(f"{URL}?{query}", timeout=60) as response:
        payload = json.load(response)
    return payload if isinstance(payload, list) else [payload]


def to_features(districts: pd.DataFrame, payloads: list) -> pd.DataFrame:
    """Long table of district × lead (1–5) with model features. Weather indices are z-scored across districts per day."""
    frames = []
    for (_, d), p in zip(districts.iterrows(), payloads):
        daily = pd.DataFrame(p["daily"])
        daily["lead"] = np.arange(len(daily))
        daily["district_id"] = d.district_id
        frames.append(daily[daily.lead.between(1, 5)])
    df = pd.concat(frames, ignore_index=True).merge(districts, on="district_id")
    df = df.rename(columns={"time": "date", "precipitation_sum": "raw_mm"})
    df["raw_mm"] = df.raw_mm.fillna(0).clip(lower=0)

    def z(column):
        return df.groupby("date")[column].transform(lambda s: ((s - s.mean()) / (s.std() or 1)).fillna(0))

    df["moisture"], df["wind"], df["mslp"] = z("relative_humidity_2m_mean"), z("wind_speed_10m_max"), z("pressure_msl_mean")
    df["day"] = pd.to_datetime(df.date).dt.dayofyear
    return df


def refresh(districts: pd.DataFrame, predict) -> None:
    """Fetch every district in paced batches, predict, and write the cache. Runs in a background thread."""
    try:
        payloads = []
        for start in range(0, len(districts), BATCH):
            if start:
                time.sleep(PAUSE_S)
            chunk = districts.iloc[start:start + BATCH]
            payloads += _fetch_batch(chunk.lat, chunk.lon)
        df = to_features(districts, payloads)
        df = df.join(predict(df).drop(columns="raw_mm"))
        keep = ["district_id", "date", "lead", "raw_mm", "served_mm", "corrected_p10", "corrected_p50", "corrected_p90",
                "dominant_regime", "gate_status", "prob_64_5", "prob_115_6", "prob_204_5", "moisture", "wind", "mslp"] + [f"regime_{r}" for r in range(6)]
        tmp = CACHE.with_suffix(".tmp")
        tmp.write_text(json.dumps({"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rows": df[keep].round(4).to_dict("records")}))
        os.replace(tmp, CACHE)  # atomic: readers never see a half-written file
        _state.update(status="ready", error=None)
    except Exception as exc:  # network, rate limit or schema change: keep serving the last cache
        global _failed_at
        _failed_at = time.time()
        _state.update(status="error", error=f"{type(exc).__name__}: {exc}")
    finally:
        _lock.release()


def _read_cache():
    """Parsed cache, re-read only when the file changes; a corrupt file counts as missing."""
    try:
        mtime = CACHE.stat().st_mtime
        if _memo["mtime"] != mtime:
            _memo.update(data=json.loads(CACHE.read_text()), mtime=mtime)
        return _memo["data"]
    except (OSError, ValueError, KeyError):
        return None


def load(districts: pd.DataFrame, predict) -> dict:
    """Return the cached live run, starting a background refresh when it is missing or stale."""
    cached = _read_cache()
    age = (datetime.now(timezone.utc) - datetime.fromisoformat(cached["fetched_at"])).total_seconds() if cached else None
    backing_off = time.time() - _failed_at < RETRY_S
    if (age is None or age > MAX_AGE_S) and not backing_off and _lock.acquire(blocking=False):
        _state.update(status="fetching", error=None)
        threading.Thread(target=refresh, args=(districts, predict), daemon=True).start()
    return {"cached": cached, "age_s": age, **_state}
