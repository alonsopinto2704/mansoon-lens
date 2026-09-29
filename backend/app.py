"""Versioned Flask API for the synthetic MonsoonLens demo."""
from functools import lru_cache
import gzip
import json
import sqlite3

from flask import Flask, Response, jsonify, request, send_from_directory
from werkzeug.middleware.proxy_fix import ProxyFix
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import joblib
import numpy as np
import pandas as pd
import yaml

from backend.data.generate_synthetic import DATA, REGIMES, ROOT
from backend import common, live
from backend.common import BadInput, error
from backend.pipeline.serve import predict
from backend.pipeline.train import FEATURES, THRESHOLDS


LAYERS = {
    "corrected": lambda i: i["served_mm"],
    "raw": lambda i: i["raw_mm"],
    "diff": lambda i: None if None in (i["served_mm"], i["raw_mm"]) else i["served_mm"] - i["raw_mm"],
    "observed": lambda i: i["observed_mm"],
    "probability": lambda i: i["prob_64_5"],
}


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
    """(date, lead, page, per_page) from the query string; the date must exist in the season."""
    lead, (page, per_page) = common.int_arg("lead", 1, 1, 5), common.paging()
    date = common.date_arg(latest_date())
    if not rows("SELECT 1 FROM forecasts WHERE date=? LIMIT 1", (date,)):
        raise common.outside_season()
    return date, lead, page, per_page


def create_app():
    app = Flask(__name__, static_folder=None)
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)  # real client IP behind a hosting proxy
    app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024
    cfg = yaml.safe_load((ROOT / "config/settings.yaml").read_text())
    CORS(app, resources={r"/api/v1/*": {"origins": [cfg["frontend_origin"]]}})
    limiter = Limiter(get_remote_address, app=app, default_limits=["600 per minute"])
    common.install(app)

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
        lead = common.int_arg("lead", None, 1, 5)  # no lead: all five
        common.flag("cached")  # accepted for parity with the serverless app; the local cache is always served first
        districts = pd.DataFrame(rows("SELECT * FROM districts"))
        state = live.load(districts, lambda df: predict(df, models(), report()["gate"]))
        cached = state.pop("cached")
        if not cached:
            return jsonify({**state, "items": []}), 202 if state["status"] == "fetching" else 503
        names = districts.set_index("district_id")[["district", "state", "lat", "lon", "terrain_m", "coast_km"]].to_dict("index")
        drop = {"moisture", "wind", "mslp", "terrain_m", "coast_km", "lat", "lon", *(f"regime_{i}" for i in range(len(REGIMES)))}
        items = [{k: v for k, v in common.explain({**names[r["district_id"]], **r, "observed_mm": None}, REGIMES, report()["gate"]).items() if k not in drop} for r in cached["rows"] if lead in (None, r["lead"]) and r["district_id"] in names]
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
        date, lead, page, per_page = selection()
        layer = common.layer_arg()
        offset = (page - 1) * per_page
        records = rows("SELECT f.district_id,d.district,d.state,d.lat,d.lon,f.date,f.lead,f.raw_mm,f.served_mm,f.corrected_p10,f.corrected_p50,f.corrected_p90,f.truth_mm AS observed_mm,f.dominant_regime,f.gate_status,f.prob_64_5,f.prob_115_6,f.prob_204_5 FROM forecasts f JOIN districts d ON f.district_id=d.district_id WHERE f.date=? AND f.lead=? ORDER BY d.district LIMIT ? OFFSET ?", (date, lead, per_page, offset))
        for item in records:
            item["value"] = LAYERS[layer](item)
        total = rows("SELECT COUNT(*) AS n FROM forecasts WHERE date=? AND lead=?", (date, lead))[0]["n"]
        return jsonify({"items": records, "total": total, "date": date, "lead": lead, "layer": layer})

    @app.get("/api/v1/districts/<district_id>")
    def district(district_id):
        date, lead, _, _ = selection()
        found = rows("SELECT f.*,d.district,d.state,d.lat,d.lon FROM forecasts f JOIN districts d ON f.district_id=d.district_id WHERE f.district_id=? AND f.date=? AND f.lead=?", (district_id, date, lead))
        if not found:
            return error("District forecast not found", "not_found", status=404)
        item = common.explain(found[0], REGIMES, report()["gate"])
        item["observed_mm"] = item.pop("truth_mm")
        season = rows("SELECT truth_mm,raw_mm,served_mm FROM forecasts WHERE district_id=? AND lead=?", (district_id, lead))
        item["season"] = common.season_stats(*(np.array([np.nan if r[k] is None else r[k] for r in season], dtype=float) for k in ("truth_mm", "raw_mm", "served_mm")))
        return jsonify(item)

    @app.get("/api/v1/regimes")
    def regimes():
        date, *_ = selection()
        return jsonify({"date": date, "items": rows("SELECT dominant_regime,COUNT(*) AS count FROM forecasts WHERE date=? AND lead=1 GROUP BY dominant_regime", (date,)), "gate": report()["gate"], "classifier": report()["classifier"]})

    @app.get("/api/v1/alerts")
    def alerts():
        date, lead, page, per_page = selection()
        threshold, minimum = common.alert_args()
        column = "prob_" + threshold.replace(".", "_")
        state = request.args.get("state")
        query = f"SELECT f.district_id,d.district,d.state,f.date,f.lead,f.{column} AS probability,f.dominant_regime,f.gate_status,f.served_mm FROM forecasts f JOIN districts d ON f.district_id=d.district_id WHERE f.date=? AND f.lead=? AND f.{column}>=?"
        params = [date, lead, minimum]
        if state:
            query += " AND d.state=?"
            params.append(state)
        query += " ORDER BY probability DESC LIMIT ? OFFSET ?"
        params.extend([per_page, (page - 1) * per_page])
        return jsonify({"items": rows(query, params), "threshold": float(threshold), "date": date})

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
    @limiter.limit("10 per hour")
    def upload():
        file = common.upload_file()
        try:
            incoming = pd.read_csv(file, nrows=common.MAX_UPLOAD_ROWS + 1)
        except Exception:  # empty file, binary junk, ragged rows, bad encoding
            raise BadInput("Unable to read CSV") from None
        missing = [name for name in FEATURES if name not in incoming]
        numeric = incoming.reindex(columns=FEATURES).apply(pd.to_numeric, errors="coerce")
        common.check_upload(len(incoming), missing, numeric.to_numpy(dtype=float))
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
