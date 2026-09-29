# MonsoonLens handoff brain

Public GitHub repository: [alonsopinto2704/mansoon-lens](https://github.com/alonsopinto2704/mansoon-lens). Local `main` tracks `origin/main`.

Updated: 2026-09-29. Update this file after material code, data, test, or deployment changes so a new agent can continue from the actual state.

## Goal and fixed requirements

Build the attached MonsoonLens brief (SIH 2026, PS 26080) as a runnable local web demo. The site states in its footer (and on the alerts page) that figures come from a sample dataset and are not an official forecast; no hackathon, problem-statement or team labels appear in the UI. Every displayed metric must be computed from generated data. Blend corrections with all six regime probabilities. Serve a corrected value for a regime only if held-out verification improves both RMSE and 64.5 mm CSI over **both** raw and global baselines with a positive 95% bootstrap interval; otherwise serve raw and expose the reason.

## Current state

- Flask API, seeded data generator, validation, LightGBM training and calibration, verification gate and report, CSV upload, seven React pages, tests, CI, Dockerfiles, Compose, and documentation are implemented.
- Frontend (2026-09-29 redesign): top navigation with light/dark/system theme, `motion` animations (route transitions, sliding nav/segmented indicators, district drawer, count-ups; honours reduced motion), code-split routes, CARTO light/dark basemaps, validated categorical chart palette, single-hue rainfall ramp and diverging change ramp. Pages: Overview, Forecast, Alerts, Regimes, Verification, How it works (`/method`; `/pipeline` redirects), Upload. Source is split into `src/pages/*`, `src/components/*`, `src/data.ts`.
- The default profile in `config/settings.yaml` creates 96 synthetic district points, five June–September seasons, and leads 1–5: 292,800 generated rows. `python -m backend.data.generate_synthetic --districts 700` creates the larger profile, followed by validation and retraining. The points are **not** real polygons.
- Latest local verification used 42,000 training rows from 2021–2023, 2024 for calibration, and 58,560 held-out 2025 rows. Active and Orographic passed the gate; Break, Depression, Coastal, and Western disturbance serve raw. These are synthetic-sample results, not forecast-skill claims.
- Backend suite: 12 passing pytest tests, including API and upload validation. Frontend suite: 2 passing Vitest tests; production build passes without bundle-size warnings. Generated artifacts in `backend/data/` are ignored by Git and should be regenerated in a clean clone.
- Browser QA (after the redesign, Playwright/Chromium) covered all seven routes in light and dark themes at 1440 px and 390 px, the district drawer (open, Escape to close) and the mobile menu; no horizontal overflow or app console errors. Earlier QA covered all routes, desktop and 390 px mobile layout, map tile loading, empty alert filters, and console errors. No horizontal overflow or console errors were found. The verification page shows computed FSS at 1, 3, and 5 nearest-district neighbourhoods.
- `docker compose up --build` is the one-command demo path. It builds both services and initializes missing data/models in the API container. The Docker CLI is unavailable on this development host, so Compose startup itself has **not** been executed here. The frontend container's Vite proxy is rewritten to use the Compose `api` hostname; the host development proxy retains localhost.
- API base: `http://localhost:5000/api/v1`; web: `http://localhost:5173`. `/api/v1/health` returns `ready` after initialization. The web may render before training is finished; refresh after health is ready.

## Exact local commands on this Windows host

Run PowerShell from the repository root. Bundled Python 3.12 and pnpm 11 are under `C:\Users\alonso\.cache\codex-runtimes\codex-primary-runtime\dependencies`. Python packages have been installed to `.vendor` and frontend packages to `frontend/node_modules` on this host.

```powershell
$env:PYTHONPATH = '.vendor'
& 'C:\Users\alonso\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m backend.data.generate_synthetic
& 'C:\Users\alonso\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m backend.data.validate
& 'C:\Users\alonso\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m backend.pipeline.train
& 'C:\Users\alonso\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m pytest backend/tests -q
```

Start `python -m backend.app` in one terminal and `pnpm dev` from `frontend/` in another, using those bundled executables or standard PATH installs. For a clean local setup, `make setup`, `make data`, `make train`, then `make api` and `make web` do the same with Python and pnpm on PATH. `make demo` requires Docker Compose and runs `docker compose up --build`.

## Key locations

- `backend/data/generate_synthetic.py`: seeded generator; `backend/data/validate.py`: QC assertions.
- `backend/pipeline/train.py`: classifier, calibration, corrections, exceedance models, stored forecasts, report.
- `backend/verification/scores.py`: scores and bootstrap gate; `backend/app.py`: current versioned API.
- `frontend/src/App.tsx` (shell, routes), `frontend/src/pages/*`, `frontend/src/components/*`, `frontend/src/styles.css` (design tokens, both themes): screens and presentation.
- `docs/method.md`, `docs/data-dictionary.md`, `docs/references.md`: method and feature definitions.
- `config/settings.yaml`: demo profile; `docker-compose.yml`: two-service launch.

## Next checks and limitations

1. Run `docker compose up --build` on a machine with Docker and verify first-start health plus browser/API integration. Docker is absent here.
2. Complete a formal WCAG keyboard and reduced-motion audit and Lighthouse accessibility run. The browser QA above covered responsive layout and visible errors but was not a formal accessibility score.
3. Add genuine district polygons and source-specific adapters only with suitable data rights and a new external validation campaign. Current adapters do not ingest NCUM/IMD/ERA5.
4. The full 700-point profile has not been timed or checked for memory use. Default 96-point data are the practical demo profile.

## Agent continuation rules

Read this file, the README, and current source before changing code. Keep the sample-data disclosure and no-fabricated-metrics rule intact. Regenerate data and retrain after changing the generator, features, or gate. Report exact tests run and update this file's status and remaining limitations before ending.
