#!/usr/bin/env bash
# Vercel build (runs on every Git push): sample data -> train -> export function data -> build web app.
set -euo pipefail
python3 -m venv /tmp/train-venv
/tmp/train-venv/bin/pip install --quiet --disable-pip-version-check -r requirements-train.txt
PY=/tmp/train-venv/bin/python
$PY -c "import lightgbm" 2>/dev/null || (dnf install -y libgomp || yum install -y libgomp)  # LightGBM needs OpenMP
$PY -m backend.data.generate_synthetic ${DISTRICTS:+--districts $DISTRICTS}
$PY -m backend.data.validate
$PY -m backend.pipeline.train
$PY -m backend.export_vercel --data-only
rm -f backend/data/synthetic.parquet backend/data/monsoonlens.db backend/data/models.joblib
cd frontend && npx --yes pnpm@9.15.9 install --frozen-lockfile && npx --yes pnpm@9.15.9 build
