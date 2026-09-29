"""Package the Vercel deployment: `python -m backend.export_vercel [out_dir]` (default deploy/vercel).

Needs trained artifacts (make data && make train) and a built frontend (pnpm build). Output:
  public/            built React app (served by Vercel's CDN)
  api/index.py       Python function entry -> backend.lite_app (Flask + numpy only)
  backend/data/      season.npz, districts.json, models.json, verification.json, geo/
"""
from pathlib import Path
import json
import shutil
import sqlite3
import sys

import joblib
import numpy as np
import pandas as pd

from backend.data.generate_synthetic import DATA, REGIMES, ROOT
from backend.lite import export_models
from backend.lite_app import FIELDS
from backend.verification.delivered import enrich_report

VERCEL_JSON = {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "outputDirectory": "public",
    "regions": ["bom1"],
    "functions": {"api/index.py": {"maxDuration": 300, "includeFiles": "backend/**", "excludeFiles": "public/**"}},
    "rewrites": [
        {"source": "/api/v1/:path*", "destination": "/api/index"},
        {"source": "/((?!assets/).*)", "destination": "/index.html"},
    ],
    "headers": [{"source": "/assets/(.*)", "headers": [{"key": "Cache-Control", "value": "public, max-age=31536000, immutable"}]}],
}


def export_data(out: Path) -> None:
    """Season arrays (dates × leads × districts), district metadata, exported trees, report and boundaries."""
    out.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DATA / "monsoonlens.db") as db:
        meta = pd.read_sql("SELECT district_id,district,state,lat,lon,terrain_m,coast_km FROM districts ORDER BY district_id", db)
        f = pd.read_sql(f"SELECT district_id,date,lead,dominant_regime,{','.join(FIELDS)} FROM forecasts", db)
    dates = np.sort(f.date.unique())
    d = np.searchsorted(dates, f.date.to_numpy())
    lead = f.lead.to_numpy() - 1
    i = pd.Index(meta.district_id).get_indexer(f.district_id)
    shape = (len(dates), 5, len(meta))
    arrays = {"dates": dates.astype(str)}
    for name in FIELDS:
        a = np.full(shape, np.nan, dtype=np.float32)
        a[d, lead, i] = f[name].to_numpy()
        arrays[name] = a
    dominant = np.zeros(shape, dtype=np.int8)
    dominant[d, lead, i] = [REGIMES.index(r) for r in f.dominant_regime]
    arrays["dominant"] = dominant
    np.savez_compressed(out / "season.npz", **arrays)
    (out / "districts.json").write_text(json.dumps(meta.to_dict("records")))
    (out / "models.json").write_text(json.dumps(export_models(joblib.load(DATA / "models.joblib"))))
    report = json.loads((DATA / "verification.json").read_text())
    if "Delivered" not in report["scores"]["Overall"]:
        with sqlite3.connect(DATA / "monsoonlens.db") as db:
            report = enrich_report(report, pd.read_sql_query("SELECT * FROM forecasts", db))
    (out / "verification.json").write_text(json.dumps(report, indent=2))
    shutil.copytree(DATA / "geo", out / "geo", dirs_exist_ok=True, ignore=shutil.ignore_patterns("*.py"))


def build(target: Path) -> None:
    dist = ROOT / "frontend" / "dist"
    if not (dist / "index.html").exists():
        sys.exit("Build the frontend first: cd frontend && pnpm build")
    target.mkdir(parents=True, exist_ok=True)
    for child in target.iterdir():  # empty in place (the folder may be a shell's cwd on Windows); keep the Vercel project link
        if child.name != ".vercel":
            shutil.rmtree(child) if child.is_dir() else child.unlink()
    shutil.copytree(dist, target / "public")
    (target / "backend").mkdir(parents=True)
    for name in ("__init__.py", "lite.py", "lite_app.py"):
        shutil.copy(ROOT / "backend" / name, target / "backend" / name)
    export_data(target / "backend" / "data" / "vercel")
    (target / "api").mkdir()
    shutil.copy(ROOT / "api" / "index.py", target / "api" / "index.py")
    shutil.copy(ROOT / "requirements.txt", target / "requirements.txt")
    (target / "vercel.json").write_text(json.dumps(VERCEL_JSON, indent=2))
    (target / ".vercelignore").write_text("__pycache__\n")
    size = sum(p.stat().st_size for p in target.rglob("*") if p.is_file()) / 2**20
    print(f"Vercel bundle ready in {target} ({size:.1f} MB)")


if __name__ == "__main__":
    if "--data-only" in sys.argv:  # Git-triggered Vercel build (vercel.json, scripts/vercel-build.sh)
        export_data(DATA / "vercel")
        print(f"Function data written to {DATA / 'vercel'}")
    else:
        build(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "deploy" / "vercel")
