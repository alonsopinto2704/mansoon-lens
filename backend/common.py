"""Trust-boundary helpers shared by backend.app (full) and backend.lite_app (serverless): numpy + Flask only.

One place for query validation, JSON-safe output, error handlers and the report builders, so both apps
give the same status codes and bodies for the same input.
"""
from datetime import datetime
from io import BytesIO, StringIO
import csv
import logging
import math
import re

import numpy as np
from flask import Response, jsonify, request, send_file
from flask.json.provider import DefaultJSONProvider
from werkzeug.exceptions import HTTPException

LAYERS = ("corrected", "raw", "diff", "observed", "probability")
THRESHOLD_KEYS = ("64.5", "115.6", "204.5")
MAX_UPLOAD_ROWS = 1000
_CODES = {404: "not_found", 405: "method_not_allowed", 413: "too_large", 429: "rate_limited"}


class BadInput(ValueError):
    """Client error: becomes a 4xx JSON `{error, code, details}`; any other exception is a generic 500."""

    def __init__(self, message, details=None, code="bad_request", status=400):
        super().__init__(message)
        self.details, self.code, self.status = details, code, status


def error(message, code="bad_request", details=None, status=400):
    return jsonify({"error": message, "code": code, "details": details or []}), status


def sanitize(obj):
    """Strict JSON has no NaN/Infinity (Flask writes them anyway): non-finite floats become null."""
    if isinstance(obj, float):
        return obj if math.isfinite(obj) else None
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [sanitize(v) for v in obj]
    return obj


class SafeJSON(DefaultJSONProvider):
    def dumps(self, obj, **kwargs):
        return super().dumps(sanitize(obj), **kwargs)


def install(app):
    """JSON provider, JSON errors for every failure, and a JSON 404 for unknown /api/v1/* paths."""
    app.json = SafeJSON(app)

    @app.errorhandler(BadInput)
    def bad_input(exc):
        return error(str(exc), exc.code, exc.details, exc.status)

    @app.errorhandler(HTTPException)
    def http_error(exc):
        return error(exc.description if exc.code != 413 else "Upload exceeds 2 MB", _CODES.get(exc.code, "bad_request"), status=exc.code)

    @app.errorhandler(Exception)
    def unexpected(exc):
        logging.getLogger(__name__).exception("unhandled error")
        return error("Internal server error", "internal", status=500)

    @app.route("/api/v1/<path:_>", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
    def not_found(_):
        return error("Not found", "not_found", status=404)


# ---------- query parameters ----------

def int_arg(name, default, lo, hi):
    """Strict base-10 integer query parameter within [lo, hi]."""
    raw = request.args.get(name)
    if raw is None:
        return default
    if not re.fullmatch(r"\d{1,9}", raw) or not lo <= int(raw) <= hi:
        raise BadInput(f"Invalid {name}: expected a whole number from {lo} to {hi}")
    return int(raw)


def paging():
    return int_arg("page", 1, 1, 10 ** 6), int_arg("per_page", 1000, 1, 1000)


def flag(name):
    """Optional 0/1 switch such as `cached`."""
    raw = request.args.get(name)
    if raw not in (None, "0", "1"):
        raise BadInput(f"Invalid {name}: expected 0 or 1")
    return raw == "1"


def date_arg(default):
    """ISO date from ?date=, or `default` when absent/empty. Membership in the season is checked by the caller."""
    date = request.args.get("date") or default
    try:
        if not isinstance(date, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            raise ValueError
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        raise BadInput("Invalid date: expected YYYY-MM-DD") from None
    return date


def outside_season():
    return BadInput("Date is outside the demo season")


def layer_arg():
    layer = request.args.get("layer", "corrected")
    if layer not in LAYERS:
        raise BadInput("Invalid layer", list(LAYERS))
    return layer


def alert_args():
    """(threshold key, minimum probability) for /alerts."""
    threshold = request.args.get("threshold", "64.5")
    if threshold not in THRESHOLD_KEYS:
        raise BadInput("Invalid threshold", list(THRESHOLD_KEYS))
    try:
        minimum = float(request.args.get("min_prob", "0.3"))
    except ValueError:
        raise BadInput("Invalid minimum probability") from None
    if not 0 <= minimum <= 1:  # also rejects NaN
        raise BadInput("Minimum probability must be between 0 and 1")
    return threshold, minimum


def verification_group(content):
    group = request.args.get("regime")
    if group and group not in content["scores"]:
        raise BadInput("Unknown verification group")
    return group


# ---------- upload ----------

def upload_file():
    file = request.files.get("file")
    if not file or not (file.filename or "").lower().endswith(".csv"):
        raise BadInput("Upload a CSV file in the 'file' field")
    return file


def check_upload(n_rows, missing, x=None):
    """Row count, columns and value checks. `x` is the float matrix in FEATURES order (raw_mm, lead first)."""
    if n_rows > MAX_UPLOAD_ROWS:
        raise BadInput(f"CSV exceeds {MAX_UPLOAD_ROWS} rows")
    if n_rows == 0:
        raise BadInput("CSV must contain at least one forecast row")
    if missing:
        raise BadInput("Missing required columns", missing)
    bad = np.flatnonzero(~np.isfinite(x).all(axis=1))
    if bad.size:
        raise BadInput("Non-numeric or missing feature values", [int(i + 2) for i in bad])
    if (x[:, 0] < 0).any() or ((x[:, 1] < 1) | (x[:, 1] > 5) | (x[:, 1] % 1 != 0)).any():
        raise BadInput("Rainfall must be nonnegative and lead must be a whole number from 1–5")


# ---------- shared response builders ----------

def explain(item, regimes, gate):
    """Adds regime probabilities, gate reason, predictors and advisory to a forecast row."""
    item["regime_probabilities"] = {name: item[f"regime_{r}"] for r, name in enumerate(regimes)}
    item["gate_reason"] = gate[item["dominant_regime"]]["reason"]
    item["drivers"] = [{"name": name, "value": item[name]} for name in ("moisture", "wind", "mslp", "terrain_m", "coast_km")]
    p = item["prob_64_5"]
    item["advisory"] = ("No heavy-rain probability available." if p is None or not math.isfinite(p) else
                        "High heavy-rain signal; check IMD district warnings." if p >= .6 else
                        "Moderate heavy-rain signal; monitor IMD updates." if p >= .3 else "Low heavy-rain signal.")
    return item


def season_stats(truth, raw, served):
    """Season summary from float arrays that may hold NaN (missing observations)."""
    rmse = lambda a: float(np.sqrt(np.nanmean((a - truth) ** 2))) if np.isfinite(truth).any() else None
    return {"days": len(truth), "heavy_days": int(np.sum(truth >= 64.5)), "rmse_raw": rmse(raw), "rmse_served": rmse(served)}


def csv_response(report):
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(["group", "model", "threshold_mm", "rmse", "bias", "pod", "far", "csi", "ets", "brier", "evaluation_note"])
    for group, models_by_name in report["scores"].items():
        for model, thresholds in models_by_name.items():
            note = report.get("delivered_evaluation", "") if model == "Delivered" else "Synthetic 2025 test season"
            for threshold, value in thresholds.items():
                writer.writerow([group, model, threshold] + [sanitize(value.get(key)) for key in ("rmse", "bias", "pod", "far", "csi", "ets", "brier")] + [note])
    return Response(output.getvalue(), mimetype="text/csv", headers={"Content-Disposition": "attachment; filename=monsoonlens-verification.csv"})


def _num(value, spec):
    return "n/a" if not isinstance(value, (int, float)) or not math.isfinite(value) else format(value, spec)


def pdf_response(report):
    from reportlab.pdfgen import canvas
    buffer = BytesIO()
    page = canvas.Canvas(buffer)
    page.setFont("Helvetica-Bold", 16)
    page.drawString(40, 790, "MonsoonLens synthetic verification")
    page.setFont("Helvetica", 9)
    page.drawString(40, 770, "Demo running on synthetic data. Not an operational forecast.")
    y = 742
    for name, gate_data in report["gate"].items():
        page.drawString(40, y, f"{name}: {gate_data.get('status')} - {str(gate_data.get('reason') or '')[:75]}")
        y -= 19
    y -= 18
    for model, values in report["scores"].get("Overall", {}).items():
        s = values.get("64.5") or {}
        page.drawString(40, y, f"{model}: RMSE {_num(s.get('rmse'), '.2f')} mm | " + " | ".join(f"{k.upper()} {_num(s.get(k), '.3f')}" for k in ("csi", "pod", "far")))
        y -= 19
    page.setFont("Helvetica", 8)
    page.drawString(40, y - 15, "Delivered: retrospective results; the gate was selected on this same season.")
    page.drawString(40, y - 28, "Independent validation is still required. Probabilities are unchanged by the gate.")
    page.save()
    buffer.seek(0)
    return send_file(buffer, mimetype="application/pdf", as_attachment=True, download_name="monsoonlens-verification.pdf")
