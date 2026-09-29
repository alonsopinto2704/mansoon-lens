# Method and verification

**Demo running on synthetic data. Not an operational forecast.** All results in this repository describe a seeded synthetic generator. They cannot be interpreted as skill on NCMRWF or IMD data.

## Data flow

`backend.data.generate_synthetic` uses seed 26080 and the profile in `config/settings.yaml`. The default profile creates 96 district points, five June–September seasons (2021–2025), and lead days 1–5. Rainfall is sampled from a heavy-tailed distribution with six persistent or geographic regimes. Regime-dependent biases and lead-dependent noise distort the synthetic truth into raw NWP-like forecasts. `backend.data.validate` rejects missing, negative, duplicate, or out-of-range records.

The split is by year: 2021–2023 for training (capped at 42,000 sampled rows), 2024 for calibration and tuning, and 2025 for held-out testing. There is no random split across seasons. Predictions for the API are written to SQLite after training; metrics and gates are written to `backend/data/verification.json`.

## Models

LightGBM predicts six regime probabilities from raw rainfall, lead, seasonal day, moisture, wind, pressure anomaly, terrain, coast distance, and location. One-vs-rest logistic calibration is fitted on 2024 probabilities, then the six outputs are normalized to sum to one. A logistic multiclass baseline is fitted but is not currently reported in the UI.

Three quantile LightGBM models (P10/P50/P90) are fitted for each regime and for a global baseline. Each regime's predicted quantiles are weighted by its calibrated probability and summed, then sorted. An Active-regime offset is selected using 2024 only. Dedicated class-weighted exceedance models are fitted for 64.5, 115.6, and 204.5 mm/day and calibrated on 2024.

## Scores and gate

The 2025 report includes overall, regime, and lead groups. It compares raw, global, and regime-aware medians using RMSE, bias, and event contingency scores: probability of detection (POD), false-alarm ratio (FAR), critical success index (CSI), and equitable threat score (ETS). The exceedance probabilities receive Brier score, Brier skill against the group's event climatology, and ten-bin reliability data. Fractions skill score (FSS) uses the nearest 1, 3, or 5 synthetic district centroids, not a physical forecast grid.

For each regime, the gate compares regime-aware to both baselines using paired week-block bootstrap samples of the 2025 season. It requires at least eight observed events above 64.5 mm/day and a positive lower bound of the 95% interval for **all four** improvements: RMSE and CSI against raw and against global. If any condition fails, `served_mm` equals `raw_mm`; `gate.reason` explains the failure. Reported raw/global/regime-aware scores remain visible regardless of gate status. In the latest generated sample, Active and Orographic pass; retraining may change this only through computed evidence.

## Real-data boundary

The current adapters identify possible forecast (NCUM-G/NEPS), rainfall truth (IMD), and predictor (ERA5) interfaces. They do not fetch, preprocess, or validate those sources. Real deployment needs data rights, daily accumulation alignment to the IMD 08:30 IST rain day, spatial matching to official districts, QC provenance, a genuinely external test period, calibration and uncertainty review, and meteorological sign-off. The map uses generated points and must not imply official district boundaries.
