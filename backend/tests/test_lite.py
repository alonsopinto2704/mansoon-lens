"""The numpy-only serverless predictor must match the LightGBM/sklearn pipeline."""
import json
import sqlite3

import joblib
import numpy as np
import pytest
import pandas as pd

from backend import lite
from backend.data.generate_synthetic import DATA
from backend.pipeline.serve import predict
from backend.pipeline.train import FEATURES


def test_lite_predict_matches_pipeline():
    saved = joblib.load(DATA / "models.joblib")
    gate = json.loads((DATA / "verification.json").read_text())["gate"]
    with sqlite3.connect(DATA / "monsoonlens.db") as db:
        rows = pd.read_sql(f"SELECT {','.join(FEATURES)} FROM forecasts ORDER BY RANDOM() LIMIT 3000", db)
    rows.loc[:5, "raw_mm"] = 0.0  # exercise zero handling
    expected = predict(rows, saved, gate)
    got = lite.predict(rows[FEATURES].to_numpy(float), json.loads(json.dumps(lite.export_models(saved))), gate)
    for column in expected.columns:
        if not pd.api.types.is_numeric_dtype(expected[column]):
            assert list(expected[column]) == list(got[column]), column
        else:
            np.testing.assert_allclose(got[column], expected[column], rtol=1e-6, atol=1e-6, err_msg=column)


@pytest.fixture(scope="module")
def lite_data(tmp_path_factory):
    """Exported Vercel data, with backend.lite_app pointed at it for this module."""
    from backend import lite_app
    from backend.export_vercel import export_data
    out = tmp_path_factory.mktemp("vercel_data")
    export_data(out)
    caches = (lite_app.report, lite_app.models, lite_app.districts, lite_app.season)
    original = lite_app.DATA
    lite_app.DATA = out
    [fn.cache_clear() for fn in caches]
    yield lite_app
    lite_app.DATA = original
    [fn.cache_clear() for fn in caches]


def test_lite_app_matches_full_api(lite_data):
    from io import BytesIO
    from backend.app import create_app
    lite_app = lite_data
    full, lite_client = create_app().test_client(), lite_app.create_app().test_client()

    meta = full.get("/api/v1/meta").json
    assert lite_client.get("/api/v1/meta").json == meta
    date = meta["dates"][40]
    a = full.get(f"/api/v1/forecast?date={date}&lead=3&per_page=1000").json
    b = lite_client.get(f"/api/v1/forecast?date={date}&lead=3&per_page=1000").json
    by_id = {i["district_id"]: i for i in b["items"]}
    assert a["total"] == b["total"] and set(by_id) == {i["district_id"] for i in a["items"]}
    for x in a["items"]:
        y = by_id[x["district_id"]]
        assert (x["dominant_regime"], x["gate_status"]) == (y["dominant_regime"], y["gate_status"])
        for k in ("raw_mm", "served_mm", "corrected_p50", "observed_mm", "prob_64_5", "value"):
            assert abs(x[k] - y[k]) < 1e-3, k
    district = a["items"][7]["district_id"]
    x = full.get(f"/api/v1/districts/{district}?date={date}&lead=3").json
    y = lite_client.get(f"/api/v1/districts/{district}?date={date}&lead=3").json
    assert x["gate_reason"] == y["gate_reason"] and x["advisory"] == y["advisory"]
    assert abs(x["season"]["rmse_served"] - y["season"]["rmse_served"]) < 1e-3 and x["season"]["heavy_days"] == y["season"]["heavy_days"]

    for query in ("lead=0", "lead=6", "date=2025-01-01", "per_page=1001", "layer=nope"):
        assert lite_client.get(f"/api/v1/forecast?{query}").status_code == 400, query
    assert lite_client.get("/api/v1/nope").status_code == 404
    assert lite_client.get("/api/v1/geo/states").json["features"]
    assert lite_client.get("/api/v1/verification/report.csv").data.startswith(b"group,model")

    csv = ",".join(FEATURES) + "\n" + ",".join(str(x[name]) for name in FEATURES) + "\n"
    up_a = full.post("/api/v1/upload", data={"file": (BytesIO(csv.encode()), "a.csv")}).json["items"][0]
    up_b = lite_client.post("/api/v1/upload", data={"file": (BytesIO(csv.encode()), "a.csv")}).json["items"][0]
    assert up_a["dominant_regime"] == up_b["dominant_regime"] and abs(up_a["served_mm"] - up_b["served_mm"]) < 1e-6
    assert lite_client.post("/api/v1/upload", data={"file": (BytesIO(b"raw_mm,lead\n1,1\n"), "x.csv")}).json["error"] == "Missing required columns"


def test_lite_live_run(lite_data, monkeypatch):
    lite_app = lite_data
    day = {"time": [f"2026-09-{d}" for d in range(24, 30)], "precipitation_sum": [0, 5, 80, None, 3, 1],
           "wind_speed_10m_max": [10, 12, 8, 9, 11, 10], "relative_humidity_2m_mean": [70, 80, 90, 60, 75, 70], "pressure_msl_mean": [1005, 1003, 1001, 1008, 1006, 1004]}
    monkeypatch.setattr(lite_app, "_fetch", lambda lats, lons: [{"daily": day} for _ in lats])
    monkeypatch.setattr(lite_app.time, "sleep", lambda s: None)
    monkeypatch.setattr(lite_app, "_live", {"data": None, "at": 0.0})
    body = lite_app.create_app().test_client().get("/api/v1/live")
    assert body.status_code == 200 and "s-maxage" in body.headers["Cache-Control"]
    items = body.json["items"]
    assert len(items) == 5 * len(lite_app.districts()) and {i["lead"] for i in items} == {1, 2, 3, 4, 5}
    assert all(i["observed_mm"] is None and 0 <= i["prob_64_5"] <= 1 and i["regime_probabilities"] for i in items)
    assert lite_app.create_app().test_client().get("/api/v1/live?lead=9").status_code == 400
