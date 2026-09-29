# MonsoonLens

Public repository: [alonsopinto2704/mansoon-lens](https://github.com/alonsopinto2704/mansoon-lens).

MonsoonLens is a Smart India Hackathon 2026 demo for problem statement 26080 by Team Code Stormers. It classifies six synthetic monsoon regimes, blends regime-specific rainfall corrections, estimates heavy-rainfall probabilities, serves district forecasts, and reports held-out verification.

> **Demo running on synthetic data. Not an operational forecast.** Do not use it for warnings or decisions.

## Run the demo

With Docker Compose installed, run from the repository root:

```sh
docker compose up --build
```

Open [http://localhost:5173](http://localhost:5173). The API is at [http://localhost:5000/api/v1/health](http://localhost:5000/api/v1/health). On a clean clone, the API container generates the configured 96-district synthetic sample and trains the models before it becomes ready. First start can take several minutes. `make demo` runs the same Compose command when Make is available. Generated Parquet, SQLite, model, and verification files stay under `backend/data/` and are ignored by Git.

For local development without Docker, use Python 3.11+ and pnpm 11:

```sh
make setup
make data
python -m backend.data.validate
make train
```

Then run `make api` and `make web` in separate terminals. On Windows without Make, run the commands in the [handoff guide](HANDOFF.md). If the UI loads before training finishes, wait until the health endpoint reports `ready` and refresh.

## What the demo computes

The seeded generator creates five monsoon seasons of district-day forecasts. Training uses 2021–2023, calibration and tuning use 2024, and the final 2025 season is held out for verification. A multiclass classifier supplies all six regime probabilities. Regime-specific P10/P50/P90 predictions are blended by those probabilities. Exceedance classifiers estimate probabilities above 64.5, 115.6, and 204.5 mm/day.

For each regime, the corrected median is served only if paired week-block bootstrap intervals show improvement in both RMSE and 64.5 mm CSI over **both** raw and global correction baselines. Otherwise the district product serves raw rainfall and gives the gate reason. In the latest generated sample, Active and Orographic pass this gate. The UI and exports draw computed values from `backend/data/verification.json`; no performance figures are built into the presentation.

See [method](docs/method.md), [data dictionary](docs/data-dictionary.md), and [source notes](docs/references.md) for details.

## API and checks

The versioned API exposes `/api/v1/health`, `/meta`, `/forecast`, `/districts/<id>`, `/regimes`, `/alerts`, `/verification`, `/verification/report.csv`, `/verification/report.pdf`, and `/upload`. Upload accepts up to 1,000 rows and 2 MB of CSV; its required fields are in the [data dictionary](docs/data-dictionary.md).

Run `make test` for backend and frontend tests and `cd frontend && pnpm build` for the production frontend build. The GitHub Actions workflow runs these checks on pushes and pull requests.

## Limits

The default sample has synthetic district **points**, not official administrative polygons, and synthetic rainfall and atmospheric predictors. Metrics measure this generated process, not real-world forecast skill. The `backend/adapters/` modules mark the future boundary for licensed forecast, observation, and reanalysis inputs. Operational use would require source permissions, geographic and time alignment, independent validation, and review by meteorological experts.

For the exact current build state and next steps, see [HANDOFF.md](HANDOFF.md).
