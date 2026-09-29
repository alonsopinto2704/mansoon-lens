# MonsoonLens

Public repository: [alonsopinto2704/mansoon-lens](https://github.com/alonsopinto2704/mansoon-lens).

MonsoonLens is a Smart India Hackathon 2026 demo for problem statement SIH26080, *Regime-Aware AI Post-Processing of Monsoon Rainfall Forecasts* (MoES / NCMRWF), by Team Code Stormers. It classifies six monsoon regimes, blends regime-specific rainfall corrections, estimates heavy-rainfall probabilities, serves a district map and table for all 781 Indian districts, and reports held-out verification (RMSE, bias, POD, FAR, CSI, ETS, Brier and FSS).

> **Not an operational forecast.** The model is trained and verified on a seeded synthetic sample. Live mode runs today's real NWP rainfall (Open-Meteo) through that model; live corrected values are unverified. Follow IMD for warnings.

## Deploy (one container)

```sh
docker compose up --build
```

Open [http://localhost:8000](http://localhost:8000). The image builds the web app, generates the sample and trains the models **at build time** (a few minutes), then serves web and API from one gunicorn process (about 1.5 GB RAM needed at build; on a small builder use `docker build --build-arg DISTRICTS=250 .`) on `$PORT` (default 8000). Any container host that sets `PORT` (Render, Railway, Fly.io, a VM) can run the root `Dockerfile` as-is. The live feed needs outbound HTTPS to `api.open-meteo.com`; the first page load after start takes about a minute while all 781 districts are fetched, then the run is cached for three hours.

## Local development

Use Python 3.11+ and pnpm 9.15.9 (the lockfile version; Docker and CI pin it):

```sh
make setup
make data
python -m backend.data.validate
make train
```

Then run `make api` and `make web` in separate terminals and open [http://localhost:5173](http://localhost:5173) (Vite proxies `/api` to port 5000). After `pnpm build` in `frontend/`, `make api` alone also serves the built site on port 5000. On Windows without Make, see the [handoff guide](HANDOFF.md).

## What the demo computes

- **Data:** the seeded generator creates five monsoon seasons for all 781 districts (real boundary polygons, centroids as locations). Training uses 2021–2023, calibration and tuning use 2024, and the 2025 season is held out.
- **Regimes and correction:** a calibrated multiclass classifier supplies all six regime probabilities. Regime-specific P10 / best-estimate / P90 models are blended by those probabilities. Class-weighted exceedance models that take the regime probabilities as inputs estimate the chance of more than 64.5, 115.6 and 204.5 mm/day.
- **Gate:** for each regime, the correction is served only if paired week-block bootstrap intervals show improvement in both RMSE and 64.5 mm CSI over **both** raw and a single global correction (raw rainfall and lead only). Otherwise raw rainfall is served with the reason. In the latest sample, Break, Depression and Western disturbance pass. All UI figures come from `backend/data/verification.json`.
- **Live feed:** Open-Meteo best-match global NWP rainfall (CC BY 4.0), days +1 to +5, run through the same models and gate.

See [method](docs/method.md), [data dictionary](docs/data-dictionary.md), and [source notes](docs/references.md).

## API and checks

`/api/v1/health`, `/meta`, `/forecast`, `/districts/<id>`, `/live`, `/geo/districts`, `/geo/states`, `/regimes`, `/alerts`, `/verification`, `/verification/report.csv`, `/verification/report.pdf`, and `/upload` (up to 1,000 rows / 2 MB of CSV). JSON responses are gzip-compressed.

Run `make test` for backend and frontend tests, and `cd frontend && pnpm build` for the production build. GitHub Actions generates a 150-district sample, trains, and runs both suites on every push.

## Limits

Season rainfall and predictors are generated, so the metrics measure that process, not real-world skill. District boundaries come from datta07/INDIAN-SHAPEFILES (MIT); Rajasthan is merged back to its 41 post-2024 districts, and other post-2023 district changes are unchecked. Operational use would need NCMRWF NCUM forecasts, IMD gridded observations aligned to the 08:30 IST rain day, independent validation, and meteorologist review.
