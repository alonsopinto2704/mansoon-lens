"""Serverless API (Vercel Python function): same /api/v1 contract as backend.app, numpy + Flask only.

Reads the files written by `python -m backend.export_vercel`: season.npz (held-out season arrays),
districts.json, models.json (exported trees), verification.json and geo/*.geojson. Live NWP runs are
fetched on request and cached by the CDN (one response holds all five leads).
ponytail: mirrors backend.app by hand; tests/test_lite.py compares both on the same queries.
"""
from datetime import datetime, timezone
from functools import lru_cache
from io import BytesIO, StringIO
from pathlib import Path
import csv
import json
import os
import time
import urllib.parse
import urllib.request

import numpy as np
from flask import Flask, Response, jsonify, request, send_file

from backend.lite import REGIMES, THRESHOLDS, predict

DATA = Path(os.environ.get("MONSOONLENS_DATA", Path(__file__).resolve().parent / "data"))
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


def error(message, code="bad_request", details=None, status=400):
    return jsonify({"error": message, "code": code, "details": details or []}), status


def explain(item):
    item["regime_probabilities"] = {name: item[f"regime_{r}"] for r, name in enumerate(REGIMES)}
    item["gate_reason"] = report()["gate"][item["dominant_regime"]]["reason"]
    item["drivers"] = [{"name": name, "value": item[name]} for name in ("moisture", "wind", "mslp", "terrain_m", "coast_km")]
    p = item["prob_64_5"]
    item["advisory"] = "High heavy-rain signal; check IMD district warnings." if p >= .6 else "Moderate heavy-rain signal; monitor IMD updates." if p >= .3 else "Low heavy-rain signal."
    return item


def selection():
    """(date index, date, lead) from the query string, with the same rules as backend.app."""
    s = season()
    dates = [str(d) for d in s["dates"]]
    try:
        lead = int(request.args.get("lead", 1))
    except ValueError:
        raise ValueError("Invalid lead")
    if not 1 <= lead <= 5:
        raise ValueError("Lead must be 1–5")
    date = request.args.get("date") or dates[-1]
    if date not in dates:
        raise ValueError("Date is outside the demo season")
    return dates.index(date), date, lead


def row(d, lead, i, date):
    s, meta = season(), districts()[i]
    item = {**meta, "date": date, "lead": lead, **{k: float(s[k][d, lead - 1, i]) for k in FIELDS}}
    name = REGIMES[int(s["dominant"][d, lead - 1, i])]
    item.update(dominant_regime=name, gate_status=report()["gate"][name]["status"])
    return item


# ---------- live NWP ----------

def _fetch(lats, lons):
    query = urllib.parse.urlencode({"latitude": ",".join(f"{v:.3f}" for v in lats), "longitude": ",".join(f"{v:.3f}" for v in lons),
                                    "daily": ",".join(DAILY), "timezone": "Asia/Kolkata", "forecast_days": 6})
    with urllib.request.urlopen(f"{OPEN_METEO}?{query}", timeout=60) as response:
        payload = json.load(response)
    return payload if isinstance(payload, list) else [payload]


def _z(a):
    """Z-score each day (column) across districts, like pandas: ddof=1, NaN-aware, NaN -> 0."""
    mean = np.nanmean(a, axis=0)
    std = np.nanstd(a, axis=0, ddof=1)
    std = np.where((std == 0) | np.isnan(std), 1, std)
    return np.nan_to_num((a - mean) / std)


def live_run():
    """Fetch all districts (paced under Open-Meteo's ~600 calls/minute), predict leads 1–5."""
    meta = districts()
    lats, lons = np.array([d["lat"] for d in meta]), np.array([d["lon"] for d in meta])
    payloads = []
    for start in range(0, len(meta), 100):
        if start:
            time.sleep(11)
        payloads += _fetch(lats[start:start + 100], lons[start:start + 100])
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


def create_app():
    app = Flask(__name__, static_folder=None)
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024

    @app.errorhandler(ValueError)
    def invalid(exc):
        return error(str(exc))

    @app.errorhandler(413)
    def too_large(_):
        return error("Upload exceeds 2 MB", "too_large", status=413)

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
        return Response((DATA / "geo" / f"{name}.geojson").read_text(encoding="utf-8"), mimetype="application/geo+json")

    @app.get("/api/v1/meta")
    def meta():
        return jsonify({"dates": [str(d) for d in season()["dates"]], "regimes": REGIMES, "thresholds": THRESHOLDS, "district_count": len(districts())})

    @app.get("/api/v1/forecast")
    def forecast():
        d, date, lead = selection()
        layer = request.args.get("layer", "corrected")
        if layer not in {"corrected", "raw", "diff", "observed", "probability"}:
            return error("Invalid layer", details=["corrected", "raw", "diff", "observed", "probability"])
        items = sorted((row(d, lead, i, date) for i in range(len(districts()))), key=lambda r: r["district"])
        for item in items:
            item["observed_mm"] = item.pop("truth_mm")
            item["value"] = {"corrected": item["served_mm"], "raw": item["raw_mm"], "diff": item["served_mm"] - item["raw_mm"],
                             "observed": item["observed_mm"], "probability": item["prob_64_5"]}[layer]
        per_page = int(request.args.get("per_page", 1000))
        page = int(request.args.get("page", 1))
        if not (1 <= per_page <= 1000 and page >= 1):
            return error("Invalid page")
        return jsonify({"items": items[(page - 1) * per_page: page * per_page], "total": len(items), "date": date, "lead": lead, "layer": layer})

    @app.get("/api/v1/districts/<district_id>")
    def district(district_id):
        d, date, lead = selection()
        index = next((i for i, m in enumerate(districts()) if m["district_id"] == district_id), None)
        if index is None:
            return error("District forecast not found", "not_found", status=404)
        item = explain(row(d, lead, index, date))
        item["observed_mm"] = item.pop("truth_mm")
        s = season()
        truth, raw, served = (s[k][:, lead - 1, index].astype(float) for k in ("truth_mm", "raw_mm", "served_mm"))
        item["season"] = {"days": len(truth), "heavy_days": int(np.sum(truth >= 64.5)), "rmse_raw": float(np.sqrt(np.mean((raw - truth) ** 2))),
                          "rmse_served": float(np.sqrt(np.mean((served - truth) ** 2)))}
        return jsonify(item)

    @app.get("/api/v1/live")
    def live():
        lead = request.args.get("lead")
        if lead is not None and lead not in {"1", "2", "3", "4", "5"}:
            return error("Lead must be 1–5")
        status, message = "ready", None
        if _live["data"] is None or time.time() - _live["at"] > LIVE_TTL_S:
            try:
                _live.update(data=live_run(), at=time.time())
            except Exception as exc:  # keep a warm instance's last run; otherwise report unavailable
                status, message = "error", f"{type(exc).__name__}: {exc}"
        cached = _live["data"]
        if not cached:
            response = jsonify({"status": "error", "error": message, "items": [], "age_s": None})
            response.headers["Cache-Control"] = "no-store"
            return response, 503
        names = {m["district_id"]: m for m in districts()}
        drop = {"moisture", "wind", "mslp", "terrain_m", "coast_km", "lat", "lon", *(f"regime_{i}" for i in range(6))}
        items = [{k: v for k, v in explain({**names[r["district_id"]], **r, "observed_mm": None}).items() if k not in drop}
                 for r in cached["rows"] if lead in (None, str(r["lead"]))]
        for item in items:
            item["value"] = item["served_mm"]
        dates = sorted({r["date"] for r in cached["rows"]})
        response = jsonify({"status": status, "error": message, "age_s": time.time() - _live["at"], "fetched_at": cached["fetched_at"], "dates": dates,
                            "lead": int(lead) if lead else None, "date": items[0]["date"] if items else None, "items": items, "total": len(items),
                            "source": "Open-Meteo best-match NWP (CC BY 4.0)"})
        # One CDN copy per 3 h (stale while revalidating) keeps the free Open-Meteo quota safe.
        response.headers["Cache-Control"] = "public, max-age=300, s-maxage=10800, stale-while-revalidate=86400" if status == "ready" else "no-store"
        return response

    @app.get("/api/v1/verification")
    def verification():
        content = report()
        regime = request.args.get("regime")
        if regime and regime not in content["scores"]:
            return error("Unknown verification group")
        if regime:
            return jsonify({"group": regime, "scores": content["scores"][regime], "gate": content["gate"].get(regime)})
        return jsonify(content)

    @app.get("/api/v1/verification/report.csv")
    def csv_report():
        output = StringIO()
        writer = csv.writer(output)
        writer.writerow(["group", "model", "threshold_mm", "rmse", "bias", "pod", "far", "csi", "ets", "brier"])
        for group, by_model in report()["scores"].items():
            for model, thresholds in by_model.items():
                for threshold, value in thresholds.items():
                    writer.writerow([group, model, threshold] + [value.get(key) for key in ("rmse", "bias", "pod", "far", "csi", "ets", "brier")])
        return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=monsoonlens-verification.csv"})

    @app.get("/api/v1/verification/report.pdf")
    def pdf_report():
        from reportlab.pdfgen import canvas
        buffer = BytesIO()
        page = canvas.Canvas(buffer)
        page.setFont("Helvetica-Bold", 16)
        page.drawString(40, 790, "MonsoonLens synthetic verification")
        page.setFont("Helvetica", 9)
        page.drawString(40, 770, "Demo running on synthetic data. Not an operational forecast.")
        y = 742
        for name, gate_data in report()["gate"].items():
            page.drawString(40, y, f"{name}: {gate_data['status']} - {gate_data['reason'][:75]}")
            y -= 19
        y -= 18
        for model, values in report()["scores"]["Overall"].items():
            s = values["64.5"]
            page.drawString(40, y, f"{model}: RMSE {s['rmse']:.2f} mm | CSI {s['csi']:.3f} | POD {s['pod']:.3f} | FAR {s['far']:.3f}")
            y -= 19
        page.save()
        buffer.seek(0)
        return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name="monsoonlens-verification.pdf")

    @app.post("/api/v1/upload")
    def upload():
        file = request.files.get("file")
        if not file or not file.filename.lower().endswith(".csv"):
            return error("Upload a CSV file in the 'file' field")
        try:
            reader = csv.DictReader(StringIO(file.read().decode("utf-8-sig")))
            records = [r for _, r in zip(range(1001), reader)]
        except (UnicodeDecodeError, csv.Error):
            return error("Unable to read CSV")
        if len(records) > 1000:
            return error("CSV exceeds 1000 rows")
        missing = [name for name in FEATURES if name not in (reader.fieldnames or [])]
        if missing:
            return error("Missing required columns", details=missing)
        x = np.full((len(records), len(FEATURES)), np.nan)
        for i, r in enumerate(records):
            for j, name in enumerate(FEATURES):
                try:
                    x[i, j] = float(r[name])
                except (TypeError, ValueError):
                    pass
        invalid_rows = np.flatnonzero(~np.isfinite(x).all(axis=1)).tolist()
        if invalid_rows:
            return error("Non-numeric or missing feature values", details=[int(i + 2) for i in invalid_rows])
        if (x[:, 0] < 0).any() or ((x[:, 1] < 1) | (x[:, 1] > 5)).any():
            return error("Rainfall must be nonnegative and lead must be 1–5")
        out = predict(x, models(), report()["gate"])
        rename = {"corrected_p10": "p10", "corrected_p50": "p50", "corrected_p90": "p90"}
        items = [{"row": i + 2, **{rename.get(k, k): (v[i] if isinstance(v, list) else float(v[i])) for k, v in out.items() if not k.startswith("regime_")}}
                 for i in range(len(records))]
        return jsonify({"items": items})

    @app.route("/api/v1/<path:_>", methods=["GET", "POST"])
    def not_found(_):
        return error("Not found", "not_found", status=404)

    return app


app = create_app()
