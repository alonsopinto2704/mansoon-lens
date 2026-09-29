"""Contract checks for the synthetic demo API."""
from io import BytesIO

import pytest

from backend.app import create_app
from backend.pipeline.train import FEATURES


@pytest.fixture(scope="module")
def client():
    app = create_app()
    app.testing = True
    return app.test_client()


def test_forecast_and_district_detail(client):
    meta = client.get("/api/v1/meta").json
    assert meta["dates"] and meta["district_count"] > 0
    date = meta["dates"][0]
    page = client.get(f"/api/v1/forecast?date={date}&lead=1&page=1&per_page=2&layer=diff")
    assert page.status_code == 200
    body = page.json
    assert body["total"] == meta["district_count"]
    assert len(body["items"]) == 2
    item = body["items"][0]
    assert item["value"] == pytest.approx(item["served_mm"] - item["raw_mm"])
    detail = client.get(f"/api/v1/districts/{item['district_id']}?date={date}")
    assert detail.status_code == 200
    assert detail.json["district_id"] == item["district_id"]
    assert sum(detail.json["regime_probabilities"].values()) == pytest.approx(1)
    assert detail.json["gate_reason"]


@pytest.mark.parametrize("query", ["lead=0", "lead=6", "page=0", "per_page=1001", "layer=nope", "date=2025-01-01"])
def test_invalid_forecast_query_is_bad_request(client, query):
    response = client.get(f"/api/v1/forecast?{query}")
    assert response.status_code == 400
    assert response.json["code"] == "bad_request"


def test_alerts_and_verification(client):
    alerts = client.get("/api/v1/alerts?threshold=64.5&min_prob=0&page=1&per_page=3")
    assert alerts.status_code == 200
    assert len(alerts.json["items"]) == 3
    assert all(0 <= item["probability"] <= 1 for item in alerts.json["items"])
    assert client.get("/api/v1/alerts?min_prob=NaN").status_code == 400
    assert client.get("/api/v1/alerts?threshold=100").status_code == 400
    assert client.get("/api/v1/verification?regime=unknown").status_code == 400
    assert client.get("/api/v1/verification/report.csv").data.startswith(b"group,model,threshold_mm")


def test_upload_validates_and_predicts(client):
    assert client.post("/api/v1/upload", data={}).status_code == 400
    assert client.post("/api/v1/upload", data={"file": (BytesIO(b"raw_mm,lead\n1,1\n"), "x.csv")}).json["error"] == "Missing required columns"

    detail = client.get("/api/v1/districts/" + client.get("/api/v1/forecast?per_page=1").json["items"][0]["district_id"]).json
    csv = ",".join(FEATURES) + "\n" + ",".join(str(detail[name]) for name in FEATURES) + "\n"
    response = client.post("/api/v1/upload", data={"file": (BytesIO(csv.encode()), "example.csv")})
    assert response.status_code == 200
    result = response.json["items"][0]
    assert result["row"] == 2
    assert 0 <= result["p10"] <= result["p50"] <= result["p90"]
    assert result["gate_status"] in {"Corrected", "Serving raw"}

    infinite = csv.replace(str(detail["raw_mm"]), "inf", 1)
    bad = client.post("/api/v1/upload", data={"file": (BytesIO(infinite.encode()), "example.csv")})
    assert bad.status_code == 400


@pytest.mark.parametrize("row", ["", "40,1.5,182,0.8,0.7,-0.5,120,40,19.1,72.8\n"])
def test_upload_rejects_empty_or_fractional_lead(client, row):
    header = "raw_mm,lead,day,moisture,wind,mslp,terrain_m,coast_km,lat,lon\n"
    response = client.post("/api/v1/upload", data={"file": (BytesIO((header + row).encode()), "example.csv")})
    assert response.status_code == 400
    assert response.json["error"]


def test_geo_layers_match_forecast_districts(client):
    districts = client.get("/api/v1/geo/districts")
    assert districts.status_code == 200
    ids = {f["properties"]["district_id"] for f in districts.get_json(force=True)["features"]}
    served = {i["district_id"] for i in client.get("/api/v1/forecast?per_page=1000").json["items"]}
    assert served and served <= ids
    assert client.get("/api/v1/geo/states").status_code == 200
    assert client.get("/api/v1/geo/nope").status_code == 404


def test_live_features_and_endpoint(client, monkeypatch):
    import pandas as pd
    from backend import live, app as app_module
    from backend.pipeline.serve import predict

    districts = pd.DataFrame(client.get("/api/v1/forecast?per_page=2").json["items"])[["district_id", "lat", "lon"]]
    districts["terrain_m"], districts["coast_km"] = 100.0, 50.0
    day = {"time": [f"2026-09-{d}" for d in range(24, 30)], "precipitation_sum": [0, 5, 80, None, 3, 1],
           "wind_speed_10m_max": [10] * 6, "relative_humidity_2m_mean": [70] * 6, "pressure_msl_mean": [1005] * 6}
    frame = live.to_features(districts, [{"daily": day}, {"daily": {**day, "precipitation_sum": [1] * 6}}])
    assert len(frame) == 10 and set(frame.lead) == {1, 2, 3, 4, 5}
    assert frame.raw_mm.min() >= 0 and frame[["moisture", "wind", "mslp"]].notna().all().all()
    out = predict(frame, app_module.models(), app_module.report()["gate"])
    assert ((out.corrected_p10 <= out.corrected_p90) & out.prob_64_5.between(0, 1)).all()

    rows = frame.join(out.drop(columns="raw_mm"))[["district_id", "date", "lead", "raw_mm", "served_mm", "corrected_p10", "corrected_p50", "corrected_p90", "dominant_regime", "gate_status", "prob_64_5", "prob_115_6", "prob_204_5", "moisture", "wind", "mslp"] + [f"regime_{r}" for r in range(6)]]
    monkeypatch.setattr(live, "load", lambda *_: {"cached": {"fetched_at": "2026-09-29T00:00:00+00:00", "rows": rows.to_dict("records")}, "age_s": 1, "status": "ready", "error": None})
    body = client.get("/api/v1/live?lead=2").json
    assert body["total"] == 2 and body["items"][0]["regime_probabilities"] and body["items"][0]["observed_mm"] is None
    monkeypatch.setattr(live, "load", lambda *_: {"cached": None, "age_s": None, "status": "fetching", "error": None})
    assert client.get("/api/v1/live").status_code == 202
    assert client.get("/api/v1/live?lead=9").status_code == 400


def test_gzip_and_spa_fallback(client):
    import gzip, json
    compressed = client.get("/api/v1/geo/states", headers={"Accept-Encoding": "gzip"})
    assert compressed.headers["Content-Encoding"] == "gzip"
    assert json.loads(gzip.decompress(compressed.data))["features"]
    assert client.get("/api/v1/does-not-exist").status_code == 404


def test_live_backoff_and_corrupt_cache(tmp_path, monkeypatch):
    import pandas as pd
    from backend import live
    calls = []

    def boom(*_):
        calls.append(1)
        raise OSError("offline")

    cache = tmp_path / "live.json"
    cache.write_text('{"fetched_at": "2026-')  # truncated file must count as missing
    monkeypatch.setattr(live, "CACHE", cache)
    monkeypatch.setattr(live, "_fetch_batch", boom)
    monkeypatch.setattr(live, "_failed_at", 0.0)
    districts = pd.DataFrame({"district_id": ["X"], "lat": [20.0], "lon": [80.0]})
    live.load(districts, None)
    live._lock.acquire(timeout=5)  # wait for the background refresh to finish
    live._lock.release()
    state = live.load(districts, None)
    assert state["cached"] is None and state["status"] == "error" and len(calls) == 1  # no immediate retry
