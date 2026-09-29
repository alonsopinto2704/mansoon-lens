"""Both apps (full and serverless) must answer bad input with the same 4xx JSON error, never a 500 or NaN."""
import json
from io import BytesIO

import pytest

from backend import common
from backend.app import create_app
from backend.tests.test_lite import lite_data  # noqa: F401  (fixture: exported Vercel data)

HEADER = "raw_mm,lead,day,moisture,wind,mslp,terrain_m,coast_km,lat,lon\n"
GOOD = "10,1,182,0.8,0.7,-0.5,120,40,19.1,72.8\n"


@pytest.fixture(scope="module")
def clients(lite_data):  # noqa: F811
    app = create_app()
    for limiter in app.extensions["limiter"]:
        limiter.enabled = False  # 10 uploads/hour would 429 the parametrised cases
    return [app.test_client(), lite_data.create_app().test_client()]


def upload(client, content, name="x.csv"):
    return client.post("/api/v1/upload", data={"file": (BytesIO(content), name)})


GET_CASES = [
    ("/api/v1/forecast?lead=abc", 400), ("/api/v1/forecast?lead=1.5", 400), ("/api/v1/forecast?lead=-1", 400), ("/api/v1/forecast?lead=", 400),
    ("/api/v1/forecast?page=x", 400), ("/api/v1/forecast?per_page=0", 400), ("/api/v1/forecast?page=99999999999", 400),
    ("/api/v1/forecast?date=nope", 400), ("/api/v1/forecast?date=2025-13-45", 400), ("/api/v1/forecast?date=2025-6-1", 400),
    ("/api/v1/forecast?date=1999-01-01", 400), ("/api/v1/forecast?layer=x", 400),
    ("/api/v1/districts/NOPE", 404), ("/api/v1/districts/NOPE?lead=9", 400), ("/api/v1/geo/nope", 404),
    ("/api/v1/live?lead=0", 400), ("/api/v1/live?lead=x", 400), ("/api/v1/live?cached=yes", 400),
    ("/api/v1/verification?regime=zzz", 400), ("/api/v1/nope", 404), ("/api/v1/nope/deeper", 404),
    ("/api/v1/meta", 200), ("/api/v1/verification", 200), ("/api/v1/verification/report.pdf", 200), ("/api/v1/verification/report.csv", 200),
]


@pytest.mark.parametrize("path,status", GET_CASES)
def test_get_status_and_json_error(clients, path, status):
    for client in clients:
        response = client.get(path)
        assert response.status_code == status, (path, response.data[:200])
        if status >= 400:
            assert response.is_json and response.json["error"]


def test_alerts_validation(clients):
    full = clients[0]  # /alerts is served by the full app only
    for query in ("threshold=1", "min_prob=2", "min_prob=nan", "min_prob=x", "lead=7", "date=x"):
        assert full.get(f"/api/v1/alerts?{query}").status_code == 400, query
    assert clients[1].get("/api/v1/alerts").status_code == 404


UPLOADS = {
    "no_file": (None, 400),
    "wrong_ext": (b"a,b\n1,2\n", 400, "x.txt"),
    "empty": (b"", 400),
    "binary": (b"\xff\xfe\x00\x01\x02" * 50, 400),
    "header_only": (HEADER.encode(), 400),
    "missing_cols": (b"raw_mm,lead\n1,1\n", 400),
    "non_numeric": ((HEADER + GOOD.replace("10,", "abc,", 1)).encode(), 400),
    "blank_value": ((HEADER + GOOD.replace("0.8", "", 1)).encode(), 400),
    "negative_rain": ((HEADER + GOOD.replace("10,", "-1,", 1)).encode(), 400),
    "lead_range": ((HEADER + GOOD.replace(",1,", ",6,", 1)).encode(), 400),
    "lead_fraction": ((HEADER + GOOD.replace(",1,", ",1.5,", 1)).encode(), 400),
    "too_many_rows": ((HEADER + GOOD * 1001).encode(), 400),
    "too_large": (b"x" * (2 * 1024 * 1024 + 1), 413, "big.csv"),
    "ok": ((HEADER + GOOD * 1000).encode(), 200),
}


@pytest.mark.parametrize("case", UPLOADS)
def test_upload_validation(clients, case):
    content, status, *name = UPLOADS[case]
    for client in clients:
        response = client.post("/api/v1/upload") if content is None else upload(client, content, *name)
        assert response.status_code == status, (case, response.data[:200])
        assert response.is_json and ("error" in response.json) == (status >= 400)


def test_wrong_method_is_json(clients):
    for client in clients:
        for response in (client.get("/api/v1/upload"), client.post("/api/v1/meta")):
            assert response.is_json and response.json["error"] and response.status_code in (404, 405)


def test_nan_becomes_null_and_pdf_survives_missing_scores():
    app = create_app()
    with app.test_request_context():
        body = app.json.dumps({"a": float("nan"), "b": [float("inf"), 1.5]})
    assert json.loads(body, parse_constant=lambda c: pytest.fail(c)) == {"a": None, "b": [None, 1.5]}
    report = {"gate": {"Active": {"status": "Corrected", "reason": None}},
              "scores": {"Overall": {"Raw": {"64.5": {"rmse": None, "csi": float("nan")}}, "Empty": {}}}}
    with app.test_request_context():
        pdf = common.pdf_response(report)
        pdf.direct_passthrough = False
        assert pdf.get_data().startswith(b"%PDF")
        assert b"nan" not in common.csv_response(report).data.lower()
