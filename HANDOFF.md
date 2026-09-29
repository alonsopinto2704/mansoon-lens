# MonsoonLens handoff brain

Public GitHub repository: [alonsopinto2704/mansoon-lens](https://github.com/alonsopinto2704/mansoon-lens). Local `main` tracks `origin/main`.

Updated: 2026-09-29. Update this file after material code, data, test, or deployment changes so a new agent can continue from the actual state.

## Goal and fixed requirements

Build the attached MonsoonLens brief (SIH 2026, PS 26080) as a runnable local web demo. The site states in its footer (and on the alerts page) that figures come from a sample dataset and are not an official forecast; no hackathon, problem-statement or team labels appear in the UI. Every displayed metric must be computed from generated data. Blend corrections with all six regime probabilities. Serve a corrected value for a regime only if held-out verification improves both RMSE and 64.5 mm CSI over **both** raw and global baselines with a positive 95% bootstrap interval; otherwise serve raw and expose the reason.

## Current state (2026-09-29, second pass)

- Problem statement confirmed from sih.gov.in: SIH26080, "Regime-Aware AI Post-Processing of Monsoon Rainfall Forecasts", MoES/NCMRWF. Deliverables: regime classifier; bias-corrected forecast vs raw NWP; heavy-rain probability; district table/map; verification with RMSE, ETS, CSI, POD, FAR, FSS. All are covered.
- **Real map:** 781 district polygons plus 36 state outlines (`backend/data/geo/`, datta07/INDIAN-SHAPEFILES, MIT; official J&K/Ladakh outline; Rajasthan merged to 41 districts). Served from `/api/v1/geo/<districts|states>` and drawn as a Leaflet choropleth with no tile server (the old CARTO tiles now need an API key). Layers: Served, Raw, Observed (season only), Change, Heavy-rain chance, Regime.
- **Generator** uses all 781 real districts (2,382,050 rows), spatially coherent daily rain and error fields, climatology, depressions limited to the trough band and western disturbances to north of 28.5°N.
- **Model changes:** the middle member is now a conditional-mean (L2) best estimate; regime models are soft-weighted by calibrated probabilities; the global baseline is raw rainfall and lead only (the "single method"); exceedance models take regime probabilities as inputs; training uses 150k rows. Latest gates: Break, Depression and Western disturbance **Corrected**; Active, Orographic and Coastal serve raw. Overall 64.5 mm: RMSE raw 28.3 / global 26.6 / regime-aware 24.8; CSI 0.523 / 0.549 / 0.583.
- **Live feed** (`backend/live.py`, `/api/v1/live`): Open-Meteo best-match NWP for all districts, days +1 to +5, paced batches, three-hour cache in `backend/data/live.json`. The frontend defaults to Live and falls back automatically to the verified season if the feed fails.
- **Deploy:** root `Dockerfile` (node build stage, then python-slim; trains at build time; gunicorn with one worker and eight threads on `$PORT`), `docker-compose.yml` on port 8000. Flask serves `frontend/dist` with SPA fallback, gzip for JSON, ProxyFix, and a 600/min default rate limit (10/hour on upload). Docker is **not installed on this host**, so the image build has not been executed; the same serving path was smoke-tested with `python -m backend.app`.
- Tests: 15 backend pytest (including live-feature transform, live endpoint states, geo/forecast id match, gzip); 2 Vitest; `tsc -b` and `vite build` pass. A clean-checkout simulation (generate 150 districts, train, pytest) passes, and CI now does the same.

## 2026-09-30 credibility pass

- Verification adds a computed **Delivered** model (gated mix of corrected and raw) per subset, plus `subset_rows` and `reliability_by_group` (`backend/verification/delivered.py`, called from `train.py` and `export_vercel.py`). Regime/lead subsets filter headline scores, outcome counts, row counts and reliability; by-lead charts and the gate table are labelled "Overall".
- District drawer: five-day outlook (live run, or consecutive season dates at a fixed lead); P10–P90 relabelled "Correction model range" with a note when the gate serves raw.
- URL carries `source`, `lead`, `layer`, `date` (season), `district`; copied live links add `shared_run` and show a notice if that run is no longer current (`frontend/src/forecastUrl.ts`, `ForecastLocation` in `App.tsx`).
- Alerts "All" ranks purely by chance; CSV adds threshold, valid date, lead, source and run time. Observed layer uses a neutral "No observation" colour.
- Later the same day: saved-district watchlist (`frontend/src/watchlist.ts`, star in the drawer, table on Overview); per-state rollup on Alerts; five-day live total in the drawer; `[`/`]` and arrow keys switch days; plainer information-first UI (no eyebrow caps, scroll fades or numbered cards).
- Backend: `backend/common.py` holds shared validators, upload checks and CSV/PDF builders for both `app.py` and `lite_app.py`. Bad input returns 400 `{error, code, details}`; unknown `/api/v1/*` returns JSON 404; NaN serialises as `null`. Pydantic is no longer used.
- Alerts "Worst of 5 days" (live, `?span=5`): one row per district at its most severe day (`worstDay` in lib.ts), with per-row dates in the CSV. Pages write URL params through `withForecastView` (store.ts) so a stale lead can never overwrite the store. A page error boundary reloads once when a chunk is missing after a redeploy.
- Tests: 65 pytest (incl. `test_validation.py`, parametrised over both apps), 14 Vitest, `tsc -b`, `vite build` pass. `backend/adapters/` is unused stub code (kept; delete if real adapters are not planned).

## Exact local commands on this Windows host

Run PowerShell from the repository root. Bundled Python 3.12 and Node are under `C:\Users\alonso\.cache\codex-runtimes\codex-primary-runtime\dependencies`. Python packages have been installed to `.vendor` and frontend packages to `frontend/node_modules` on this host.

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

1. Run `docker build .` on a machine with Docker and check that `/api/v1/health` and `/api/v1/live` work in the container (the live feed needs outbound HTTPS).
2. Live corrected values come from a model trained on synthetic predictors, with humidity, wind and pressure z-scored per day as stand-ins. Real skill needs NCUM forecasts plus IMD gridded truth.
3. District changes after 2023 are unchecked, apart from Rajasthan's 2024 merge.
4. There is no ESLint setup (the unused `lint` script was removed); `tsc -b` with unused-locals checks is the lint gate. Token contrast was checked against WCAG AA; a full Lighthouse pass is still pending.

## Agent continuation rules

Read this file, the README, and current source before changing code. Keep the sample-data disclosure and no-fabricated-metrics rule intact. Regenerate data and retrain after changing the generator, features, or gate. Report exact tests run and update this file's status and remaining limitations before ending.
