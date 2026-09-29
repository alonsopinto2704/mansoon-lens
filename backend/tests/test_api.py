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


@pytest.mark.parametrize("query", ["lead=0", "lead=6", "page=0", "per_page=701", "layer=nope", "date=2025-01-01"])
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
