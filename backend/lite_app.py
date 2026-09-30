"""Serverless API (Vercel Python function): same /api/v1 contract as backend.app, numpy + Flask only.

Reads the files written by `python -m backend.export_vercel` into backend/data/vercel: season.npz (held-out season arrays),
districts.json, models.json (exported trees), verification.json and geo/*.geojson. Live NWP runs are
fetched on request and cached by the CDN (one response holds all five leads).
ponytail: mirrors backend.app by hand; tests/test_lite.py compares both on the same queries.
"""
from datetime import datetime, timezone
from functools import lru_cache
from io import StringIO
from pathlib import Path
import csv
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

import numpy as np
from flask import Flask, Response, jsonify, request

from backend import common
from backend.common import error
from backend.lite import REGIMES, THRESHOLDS, predict

DATA = Path(os.environ.get("MONSOONLENS_DATA", Path(__file__).resolve().parent / "data" / "vercel"))
FEATURES = ["raw_mm", "lead", "day", "moisture", "wind", "mslp", "terrain_m", "coast_km", "lat", "lon"]
FIELDS = ["raw_mm", "served_mm", "corrected_p10", "corrected_p50", "corrected_p90", "truth_mm", "prob_64_5", "prob_115_6", "prob_204_5",
          "moisture", "wind", "mslp"] + [f"regime_{r}" for r in range(6)]
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
DAILY = ["precipitation_sum", "wind_speed_10m_max", "relative_humidity_2m_mean", "pressure_msl_mean"]
LIVE_TTL_S = 3 * 3600
_live = {"data": None, "at": 0.0}


def load_json(name):
    return json.loads((DATA / name).read_text(encoding="utf-8"))


@lru_cache
def report():
    return load_json("verification.json")


@lru_cache
def models():
    return load_json("models.json")


@lru_cache
def districts():
    return load_json("districts.json")


@lru_cache
def season():
    with np.load(DATA / "season.npz") as z:
        return {k: z[k] for k in z.files}


def selection():
    """(date index, date, lead) from the query string, with the same rules as backend.app."""
    dates = [str(d) for d in season()["dates"]]
    lead = common.int_arg("lead", 1, 1, 5)
    date = common.date_arg(dates[-1])
    if date not in dates:
        raise common.outside_season()
    return dates.index(date), date, lead


def row(d, lead, i, date):
    s, meta = season(), districts()[i]
    item = {**meta, "date": date, "lead": lead, **{k: float(s[k][d, lead - 1, i]) for k in FIELDS}}
    name = REGIMES[int(s["dominant"][d, lead - 1, i])]
    item.update(dominant_regime=name, gate_status=report()["gate"][name]["status"])
    return item


# ---------- live NWP ----------

def _fetch(lats, lons, retries=3):
    """One Open-Meteo multi-location call; backs off on HTTP 429 (Vercel egress IPs are shared)."""
    query = urllib.parse.urlencode({"latitude": ",".join(f"{v:.3f}" for v in lats), "longitude": ",".join(f"{v:.3f}" for v in lons),
                                    "daily": ",".join(DAILY), "timezone": "Asia/Kolkata", "forecast_days": 6})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(f"{OPEN_METEO}?{query}", timeout=60) as response:
                payload = json.load(response)
            return payload if isinstance(payload, list) else [payload]
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == retries:
                raise
            time.sleep(15 * (attempt + 1))


def _z(a):
    """Z-score each day (column) across districts, like pandas: ddof=1, NaN-aware, NaN -> 0."""
    mean = np.nanmean(a, axis=0)
    std = np.nanstd(a, axis=0, ddof=1)
    std = np.where((std == 0) | np.isnan(std), 1, std)
    return np.nan_to_num((a - mean) / std)


def live_run():
    """Fetch every district's NWP (deduplicated to a 0.5° grid, paced under Open-Meteo's per-minute limit), predict leads 1–5."""
    meta = districts()
    lats, lons = np.array([d["lat"] for d in meta]), np.array([d["lon"] for d in meta])
    # ponytail: 0.5° grid (644 points for 781 districts) matches NWP resolution and cuts API calls ~18%.
    grid, cell = np.unique(np.column_stack([np.round(lats * 2) / 2, np.round(lons * 2) / 2]), axis=0, return_inverse=True)
    points = []
    for start in range(0, len(grid), 100):
        if start:
            time.sleep(13)
        points += _fetch(grid[start:start + 100, 0], grid[start:start + 100, 1])
    payloads = [points[k] for k in cell.reshape(-1)]
    grab = lambda key: np.array([[np.nan if v is None else v for v in p["daily"][key]] for p in payloads], dtype=float)
    rain, wind, rh, mslp = (grab(k) for k in DAILY)
    days = payloads[0]["daily"]["time"]
    zm, zw, zp = _z(rh), _z(wind), _z(mslp)
    n = len(meta)
    rows = []
    for lead in range(1, 6):
        doy = datetime.strptime(days[lead], "%Y-%m-%d").timetuple().tm_yday
        x = np.column_stack([np.clip(np.nan_to_num(rain[:, lead]), 0, None), np.full(n, lead), np.full(n, doy), zm[:, lead], zw[:, lead], zp[:, lead],
                             [d["terrain_m"] for d in meta], [d["coast_km"] for d in meta], lats, lons])
        out = predict(x, models(), report()["gate"])
        for i, d in enumerate(meta):
            rows.append({"district_id": d["district_id"], "date": days[lead], "lead": lead, "moisture": x[i, 3], "wind": x[i, 4], "mslp": x[i, 5],
                         **{k: (v[i] if isinstance(v, list) else round(float(v[i]), 4)) for k, v in out.items()}})
    return {"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "rows": rows}


def _age(run):
    return (datetime.now(timezone.utc) - datetime.fromisoformat(run["fetched_at"])).total_seconds()


@lru_cache
def snapshot():
    """Live run fetched at build time (scripts/vercel-build.sh), so the first visitor never waits."""
    try:
        return load_json("live_snapshot.json")
    except (OSError, ValueError):
        return None


def best_run():
    """Newest run available without calling Open-Meteo: this instance's memo or the build-time snapshot."""
    runs = [r for r in (_live["data"], snapshot()) if r]
    return max(runs, key=lambda r: r["fetched_at"]) if runs else None


def write_snapshot():
    (DATA / "live_snapshot.json").write_text(json.dumps(live_run()))
    print("Live snapshot written")


def create_app():
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

    common.install(app)

    @app.after_request
    def cache(response):
        if request.method == "GET" and response.status_code == 200 and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "public, max-age=60, s-maxage=86400"  # data only changes on redeploy
        return response

    @app.get("/api/v1/health")
    def health():
        return jsonify({"status": "ready", "synthetic": True})

    @app.get("/api/v1/geo/<name>")
    def geo(name):
        if name not in {"districts", "states"}:
            return error("Unknown boundary layer", "not_found", ["districts", "states"], 404)
        return Response((DATA / "geo" / f"{name}.geojson").read_text(encoding="utf-8"), mimetype="application/geo+json",
                        headers={"Cache-Control": "public, max-age=86400, s-maxage=86400"})  # boundaries only change on redeploy

    @app.get("/api/v1/meta")
    def meta():
        return jsonify({"dates": [str(d) for d in season()["dates"]], "regimes": REGIMES, "thresholds": THRESHOLDS, "district_count": len(districts())})

    @app.get("/api/v1/forecast")
    def forecast():
        d, date, lead = selection()
        layer = common.layer_arg()
        page, per_page = common.paging()
        items = sorted((row(d, lead, i, date) for i in range(len(districts()))), key=lambda r: r["district"])
        for item in items:
            item["observed_mm"] = item.pop("truth_mm")
            item["value"] = {"corrected": item["served_mm"], "raw": item["raw_mm"], "diff": item["served_mm"] - item["raw_mm"],
                             "observed": item["observed_mm"], "probability": item["prob_64_5"]}[layer]
        return jsonify({"items": items[(page - 1) * per_page: page * per_page], "total": len(items), "date": date, "lead": lead, "layer": layer})

    @app.get("/api/v1/districts/<district_id>")
    def district(district_id):
        d, date, lead = selection()
        index = next((i for i, m in enumerate(districts()) if m["district_id"] == district_id), None)
        if index is None:
            return error("District forecast not found", "not_found", status=404)
        item = common.explain(row(d, lead, index, date), REGIMES, report()["gate"])
        item["observed_mm"] = item.pop("truth_mm")
        s = season()
        item["season"] = common.season_stats(*(s[k][:, lead - 1, index].astype(float) for k in ("truth_mm", "raw_mm", "served_mm")))
        return jsonify(item)

    @app.get("/api/v1/live")
    def live():
        lead = common.int_arg("lead", None, 1, 5)
        cached_only = common.flag("cached")
        status, message = "ready", None
        run = best_run()
        # `cached=1` never calls Open-Meteo, so pages paint at once; the plain request refreshes when the run is stale.
        if not cached_only and (run is None or _age(run) > LIVE_TTL_S):
            try:
                _live.update(data=live_run(), at=time.time())
                run = _live["data"]
            except Exception as exc:  # rate limit or network: serve the last run, labelled with its fetch time
                status, message = "error", f"{type(exc).__name__}: {exc}"
        cached = run
        if not cached:
            response = jsonify({"status": "error", "error": message or "No live run available yet", "items": [], "age_s": None})
            response.headers["Cache-Control"] = "public, s-maxage=60" if message else "no-store"  # don't hammer the API on failure
            return response, 503
        names = {m["district_id"]: m for m in districts()}
        drop = {"moisture", "wind", "mslp", "terrain_m", "coast_km", "lat", "lon", *(f"regime_{i}" for i in range(6))}
        items = [{k: v for k, v in common.explain({**names[r["district_id"]], **r, "observed_mm": None}, REGIMES, report()["gate"]).items() if k not in drop}
                 for r in cached["rows"] if lead in (None, r["lead"])]
        for item in items:
            item["value"] = item["served_mm"]
        dates = sorted({r["date"] for r in cached["rows"]})
        response = jsonify({"status": status, "error": message, "age_s": _age(cached), "fetched_at": cached["fetched_at"], "dates": dates,
                            "lead": lead, "date": items[0]["date"] if items else None, "items": items, "total": len(items),
                            "source": "Open-Meteo best-match NWP (CC BY 4.0)"})
        # One CDN copy per 3 h (stale while revalidating) keeps the free Open-Meteo quota safe.
        fresh_for = max(60, int(LIVE_TTL_S - _age(cached)))
        response.headers["Cache-Control"] = (f"public, max-age=60, s-maxage={fresh_for}, stale-while-revalidate=86400" if status == "ready"
                                             else "public, max-age=30, s-maxage=120")
        return response

    @app.get("/api/v1/verification")
    def verification():
        content = report()
        regime = common.verification_group(content)
        if regime:
            return jsonify({"group": regime, "scores": content["scores"][regime], "gate": content["gate"].get(regime)})
        return jsonify(content)

    @app.get("/api/v1/verification/report.csv")
    def csv_report():
        return common.csv_response(report())

    @app.get("/api/v1/verification/report.pdf")
    def pdf_report():
        return common.pdf_response(report())

    @app.post("/api/v1/upload")
    def upload():
        file = common.upload_file()
        try:
            reader = csv.DictReader(StringIO(file.read().decode("utf-8-sig")))
            records = [r for _, r in zip(range(common.MAX_UPLOAD_ROWS + 1), reader)]
            fields = reader.fieldnames or []
        except (UnicodeDecodeError, csv.Error):
            raise common.BadInput("Unable to read CSV") from None
        x = np.full((len(records), len(FEATURES)), np.nan)
        for i, r in enumerate(records):
            for j, name in enumerate(FEATURES):
                try:
                    x[i, j] = float(r[name])
                except (KeyError, TypeError, ValueError):
                    pass
        common.check_upload(len(records), [name for name in FEATURES if name not in fields], x)
        out = predict(x, models(), report()["gate"])
        rename = {"corrected_p10": "p10", "corrected_p50": "p50", "corrected_p90": "p90"}
        items = [{"row": i + 2, **{rename.get(k, k): (v[i] if isinstance(v, list) else float(v[i])) for k, v in out.items() if not k.startswith("regime_")}}
                 for i in range(len(records))]
        return jsonify({"items": items})

    return app


app = create_app()
