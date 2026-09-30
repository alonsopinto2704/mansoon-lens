# Method and verification

**Demo running on synthetic data. Not an operational forecast.** All results in this repository describe a seeded synthetic generator. They cannot be interpreted as skill on NCMRWF or IMD data.

## Data flow

`backend.data.generate_synthetic` uses seed 26080 and the profile in `config/settings.yaml`. The default profile uses all 781 real districts (centroids of the bundled boundary polygons), five June–September seasons (2021–2025), and lead days 1–5: 2,382,050 rows. Rainfall is heavy-tailed, driven by six regimes (depressions only in the central/east trough band, western disturbances only north of 28.5°N) and a synthetic climatology (wet west coast and north-east, dry north-west). A smooth daily random field makes neighbouring districts rain together. Raw NWP-like forecasts apply regime-dependent biases, a spatially coherent lead-growing error field and noise. `--districts N` generates an even subset. `backend.data.validate` rejects missing, negative, duplicate, or out-of-range records.

The split is by year: 2021–2023 for training (150,000 sampled rows), 2024 for calibration and tuning, and 2025 for held-out testing. There is no random split across seasons. Predictions for the API are written to SQLite after training; metrics and gates are written to `backend/data/verification.json`.

## Models

LightGBM predicts six regime probabilities from raw rainfall, lead, seasonal day, moisture, wind, pressure anomaly, terrain, coast distance, and location. One-vs-rest logistic calibration is fitted on 2024 probabilities, then the six outputs are normalized to sum to one. A logistic multiclass baseline is fitted but is not currently reported in the UI.

Each regime has three LightGBM models: P10 and P90 quantile models and a conditional-mean (L2) best estimate, the RMSE-optimal point forecast. Each regime's models are trained on every training row weighted by that regime's calibrated probability, matching how they are blended at prediction time. Predictions are weighted by the calibrated probabilities and summed, then sorted. The global baseline is the “single bias-correction method” of the problem statement: the same three models fitted on raw rainfall and lead only. An Active-regime offset is selected using 2024 only. Class-weighted exceedance models for 64.5, 115.6 and 204.5 mm/day take the predictors plus the six regime probabilities as inputs and are calibrated on 2024.

## Scores and gate

The 2025 report includes overall, regime, and lead groups. It compares raw, global, and regime-aware best estimates using RMSE, bias, and event contingency scores: probability of detection (POD), false-alarm ratio (FAR), critical success index (CSI), and equitable threat score (ETS). The exceedance probabilities receive Brier score, Brier skill against the group's event climatology, and ten-bin reliability data. Fractions skill score (FSS) uses the nearest 1, 3, or 5 synthetic district centroids, not a physical forecast grid.

For each regime, the gate compares regime-aware to both baselines using paired week-block bootstrap samples of the 2025 season. It requires at least eight observed events above 64.5 mm/day and a positive lower bound of the 95% interval for **all four** improvements: RMSE and CSI against raw and against global. If any condition fails, `served_mm` equals `raw_mm`; `gate.reason` explains the failure. Reported raw/global/regime-aware scores remain visible regardless of gate status. In the latest generated sample, Break, Depression and Western disturbance pass; retraining may change this only through computed evidence.

## Real-data boundary

Real inputs would be NCUM-G/NEPS forecasts, IMD rainfall truth and ERA5 predictors; none is connected yet. Real deployment needs data rights, daily accumulation alignment to the IMD 08:30 IST rain day, spatial matching to official districts, QC provenance, a genuinely external test period, calibration and uncertainty review, and meteorological sign-off. The map draws real district polygons, but all season rainfall on it is generated.

## Live NWP feed

`backend/live.py` fetches Open-Meteo's best-match global NWP daily rainfall (plus humidity, wind and pressure, z-scored across districts per day) for all 781 district centroids, days +1 to +5, in paced batches of 100 under the free-tier rate limit. The run is cached in `backend/data/live.json` for three hours and refreshed in a background thread. It is passed through the same classifier, correction and gate. Because the models were trained on the synthetic sample, live corrected values are unverified. Open-Meteo rain days are 00–24 IST, not the IMD 08:30 IST day. Attribution: Open-Meteo, CC BY 4.0.
