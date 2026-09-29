"""Versioned Flask API for the synthetic MonsoonLens demo."""
from functools import lru_cache
from io import BytesIO, StringIO
from pathlib import Path
import csv
import gzip
import json
import sqlite3

from flask import Flask, Response, jsonify, request, send_file, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from pydantic import BaseModel, Field, ValidationError
import joblib
import numpy as np
import pandas as pd
import yaml

from backend.data.generate_synthetic import DATA, REGIMES, ROOT
from backend import live
from backend.pipeline.serve import predict
from backend.pipeline.train import FEATURES, THRESHOLDS


class Selection(BaseModel):
    date: str | None = None
    lead: int = Field(default=1, ge=1, le=5)
    page: int = Field(default=1, ge=1)
    per_page: int = Field(default=1000, ge=1, le=1000)


LAYERS = {
    "corrected": lambda i: i["served_mm"],
    "raw": lambda i: i["raw_mm"],
    "diff": lambda i: i["served_mm"] - i["raw_mm"],
    "observed": lambda i: i["observed_mm"],
    "probability": lambda i: i["prob_64_5"],
}


def explain(item):
    """Adds regime probabilities, gate reason, predictors and advisory to a forecast row."""
    item["regime_probabilities"] = {name: item[f"regime_{r}"] for r, name in enumerate(REGIMES)}
    item["gate_reason"] = report()["gate"][item["dominant_regime"]]["reason"]
    item["drivers"] = [{"name": name, "value": item[name]} for name in ("moisture", "wind", "mslp", "terrain_m", "coast_km")]
    p = item["prob_64_5"]
    item["advisory"] = "High heavy-rain signal; check IMD district warnings." if p >= .6 else "Moderate heavy-rain signal; monitor IMD updates." if p >= .3 else "Low heavy-rain signal."
    return item


def error(message, code="bad_request", details=None, status=400):
    return jsonify({"error": message, "code": code, "details": details or []}), status


@lru_cache
def report():
    return json.loads((DATA / "verification.json").read_text())


@lru_cache
def geo_text(name):
    return (DATA / "geo" / f"{name}.geojson").read_text(encoding="utf-8")


@lru_cache
def models():
    return joblib.load(DATA / "models.joblib")


def db():
    connection = sqlite3.connect(DATA / "monsoonlens.db")
    connection.row_factory = sqlite3.Row
    return connection


def rows(sql, params=()):
    with db() as connection:
        return [dict(row) for row in connection.execute(sql, params)]


def latest_date():
    return rows("SELECT MAX(date) AS date FROM forecasts")[0]["date"]


def selection():
    value = Selection.model_validate(request.args.to_dict())
    date = value.date or latest_date()
    if not pd.to_datetime(date, format="%Y-%m-%d", errors="coerce") == pd.to_datetime(date, format="%Y-%m-%d", errors="coerce"):
        raise ValueError("Invalid date")
    if not rows("SELECT 1 FROM forecasts WHERE date=? LIMIT 1", (date,)):
        raise ValueError("Date is outside the demo season")
    return value, date


def create_app():
    app = Flask(__name__, static_folder=None)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)  # real client IP behind a hosting proxy
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    cfg = yaml.safe_load((ROOT / "config/settings.yaml").read_text())
    CORS(app, resources={r"/api/v1/*": {"origins": [cfg["frontend_origin"]]}})
    limiter = Limiter(get_remote_address, app=app, default_limits=["600 per minute"])

    @app.after_request
    def compress(response):
        # JSON/GeoJSON payloads (boundaries, 781-district lists) shrink ~5x; gunicorn does not gzip by itself.
        if (response.mimetype in {"application/json", "application/geo+json"} and response.status_code == 200 and not response.direct_passthrough
                and "gzip" in request.headers.get("Accept-Encoding", "") and "Content-Encoding" not in response.headers):
            response.set_data(gzip.compress(response.get_data(), 6))
            response.headers["Content-Encoding"] = "gzip"
            response.headers["Vary"] = "Accept-Encoding"
        return response

    @app.after_request
    def cache(response):
        if request.method == "GET" and response.status_code == 200 and "Cache-Control" not in response.headers:
            response.headers["Cache-Control"] = "public, max-age=60"
        return response

    @app.errorhandler(ValidationError)
    def validation(exc):
        return error("Invalid query", details=exc.errors(include_url=False))

    @app.errorhandler(ValueError)
    def invalid(exc):
        return error(str(exc))

    @app.errorhandler(413)
    def too_large(_):
        return error("Upload exceeds 2 MB", "too_large", status=413)

    @app.get("/api/v1/health")
    def health():
        ready = (DATA / "monsoonlens.db").exists() and (DATA / "verification.json").exists()
        return jsonify({"status": "ready" if ready else "setup_required", "synthetic": True})

    @app.get("/api/v1/geo/<name>")
    def geo(name):
        if name not in {"districts", "states"}:
            return error("Unknown boundary layer", "not_found", ["districts", "states"], 404)
        response = Response(geo_text(name), mimetype="application/geo+json")
        response.headers["Cache-Control"] = "public, max-age=86400"
        return response

    @app.get("/api/v1/live")
    def live_forecast():
        lead = Selection.model_validate({"lead": request.args.get("lead", 1)}).lead
        districts = pd.DataFrame(rows("SELECT * FROM districts"))
        state = live.load(districts, lambda df: predict(df, models(), report()["gate"]))
        cached = state.pop("cached")
        if not cached:
            return jsonify({**state, "items": []}), 202 if state["status"] == "fetching" else 503
        names = districts.set_index("district_id")[["district", "state", "lat", "lon", "terrain_m", "coast_km"]].to_dict("index")
        drop = {"moisture", "wind", "mslp", "terrain_m", "coast_km", "lat", "lon", *(f"regime_{i}" for i in range(len(REGIMES)))}
        items = [{k: v for k, v in explain({**names[r["district_id"]], **r, "observed_mm": None}).items() if k not in drop} for r in cached["rows"] if r["lead"] == lead and r["district_id"] in names]
        for item in items:
            item["value"] = item["served_mm"]
        dates = sorted({r["date"] for r in cached["rows"]})
        response = jsonify({**state, "fetched_at": cached["fetched_at"], "dates": dates, "lead": lead, "date": items[0]["date"] if items else None, "items": items, "total": len(items),
                            "source": "Open-Meteo best-match NWP (CC BY 4.0)"})
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/api/v1/meta")
    def meta():
        dates = rows("SELECT DISTINCT date FROM forecasts ORDER BY date")
        return jsonify({"dates": [r["date"] for r in dates], "regimes": REGIMES, "thresholds": THRESHOLDS, "district_count": rows("SELECT COUNT(*) AS n FROM districts")[0]["n"]})

    @app.get("/api/v1/forecast")
    def forecast():
        selected, date = selection()
        layer = request.args.get("layer", "corrected")
        if layer not in LAYERS:
            return error("Invalid layer", details=list(LAYERS))
        offset = (selected.page - 1) * selected.per_page
        records = rows("SELECT f.district_id,d.district,d.state,d.lat,d.lon,f.date,f.lead,f.raw_mm,f.served_mm,f.corrected_p10,f.corrected_p50,f.corrected_p90,f.truth_mm AS observed_mm,f.dominant_regime,f.gate_status,f.prob_64_5,f.prob_115_6,f.prob_204_5 FROM forecasts f JOIN districts d ON f.district_id=d.district_id WHERE f.date=? AND f.lead=? ORDER BY d.district LIMIT ? OFFSET ?", (date, selected.lead, selected.per_page, offset))
        for item in records:
            item["value"] = LAYERS[layer](item)
        total = rows("SELECT COUNT(*) AS n FROM forecasts WHERE date=? AND lead=?", (date, selected.lead))[0]["n"]
        return jsonify({"items": records, "total": total, "date": date, "lead": selected.lead, "layer": layer})

    @app.get("/api/v1/districts/<district_id>")
    def district(district_id):
        selected, date = selection()
        found = rows("SELECT f.*,d.district,d.state,d.lat,d.lon FROM forecasts f JOIN districts d ON f.district_id=d.district_id WHERE f.district_id=? AND f.date=? AND f.lead=?", (district_id, date, selected.lead))
        if not found:
            return error("District forecast not found", "not_found", status=404)
        item = explain(found[0])
        item["observed_mm"] = item.pop("truth_mm")
        season = rows("SELECT truth_mm,raw_mm,served_mm FROM forecasts WHERE district_id=? AND lead=?", (district_id, selected.lead))
        truth, raw, served = (np.array([r[k] for r in season]) for k in ("truth_mm", "raw_mm", "served_mm"))
        item["season"] = {"days": len(season), "heavy_days": int(np.sum(truth >= 64.5)), "rmse_raw": float(np.sqrt(np.mean((raw - truth) ** 2))), "rmse_served": float(np.sqrt(np.mean((served - truth) ** 2)))}
        return jsonify(item)

    @app.get("/api/v1/regimes")
    def regimes():
        _, date = selection()
        return jsonify({"date": date, "items": rows("SELECT dominant_regime,COUNT(*) AS count FROM forecasts WHERE date=? AND lead=1 GROUP BY dominant_regime", (date,)), "gate": report()["gate"], "classifier": report()["classifier"]})

    @app.get("/api/v1/alerts")
    def alerts():
        selected, date = selection()
        threshold = request.args.get("threshold", "64.5")
        if threshold not in {"64.5", "115.6", "204.5"}:
            return error("Invalid threshold")
        try:
            minimum = float(request.args.get("min_prob", "0.3"))
        except ValueError:
            return error("Invalid minimum probability")
        if not 0 <= minimum <= 1:
            return error("Minimum probability must be between 0 and 1")
        column = "prob_" + threshold.replace(".", "_")
        state = request.args.get("state")
        query = f"SELECT f.district_id,d.district,d.state,f.date,f.lead,f.{column} AS probability,f.dominant_regime,f.gate_status,f.served_mm FROM forecasts f JOIN districts d ON f.district_id=d.district_id WHERE f.date=? AND f.lead=? AND f.{column}>=?"
        params = [date, selected.lead, minimum]
        if state:
            query += " AND d.state=?"
            params.append(state)
        query += " ORDER BY probability DESC LIMIT ? OFFSET ?"
        params.extend([selected.per_page, (selected.page-1)*selected.per_page])
        return jsonify({"items": rows(query, params), "threshold": float(threshold), "date": date})

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
        for group, models_by_name in report()["scores"].items():
            for model, thresholds in models_by_name.items():
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
    @limiter.limit("10 per hour")
    def upload():
        file = request.files.get("file")
        if not file or not file.filename.lower().endswith(".csv"):
            return error("Upload a CSV file in the 'file' field")
        try:
            incoming = pd.read_csv(file, nrows=1001)
        except Exception:
            return error("Unable to read CSV")
        if len(incoming) > 1000:
            return error("CSV exceeds 1000 rows")
        if incoming.empty:
            return error("CSV must contain at least one forecast row")
        missing = [name for name in FEATURES if name not in incoming]
        if missing:
            return error("Missing required columns", details=missing)
        numeric = incoming[FEATURES].apply(pd.to_numeric, errors="coerce")
        invalid_rows = np.flatnonzero(~np.isfinite(numeric.to_numpy(dtype=float)).all(axis=1)).tolist()
        if invalid_rows:
            return error("Non-numeric or missing feature values", details=[int(i+2) for i in invalid_rows])
        if (numeric.raw_mm < 0).any() or (~numeric.lead.between(1, 5)).any() or (numeric.lead % 1 != 0).any():
            return error("Rainfall must be nonnegative and lead must be a whole number from 1–5")
        result = predict(numeric, models(), report()["gate"])
        result.insert(0, "row", np.arange(2, len(result) + 2))
        items = result.drop(columns=[f"regime_{r}" for r in range(len(REGIMES))]).rename(columns={"corrected_p10": "p10", "corrected_p50": "p50", "corrected_p90": "p90"}).to_dict("records")
        return jsonify({"items": items})

    # Production: serve the built frontend from the same origin (SPA fallback to index.html).
    web = ROOT / "frontend" / "dist"

    @app.get("/", defaults={"path": ""})
    @app.get("/<path:path>")
    def spa(path):
        if path.startswith("api/"):
            return error("Not found", "not_found", status=404)
        if not (web / "index.html").exists():
            return error("Frontend not built: run `pnpm build` in frontend/", "not_found", status=404)
        if path and (web / path).is_file():
            return send_from_directory(web, path, max_age=31536000 if path.startswith("assets/") else 0)
        return send_from_directory(web, "index.html", max_age=0)

    return app


if __name__ == "__main__":
    import os
    create_app().run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False)
