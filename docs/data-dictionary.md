# Synthetic data dictionary

Source: `backend/data/generate_synthetic.py`. Units and meanings below apply to the generated demo only.

| Column | Meaning |
| --- | --- |
| `district_id` | Generated identifier such as `D0001`. |
| `date` | Forecast valid date, `YYYY-MM-DD`, June–September in 2021–2025. |
| `season` | Year of the synthetic monsoon season. |
| `day` | Day of year, used as a seasonal feature. |
| `lead` | Forecast lead, integer 1–5 days. |
| `regime_true` | Generator's hidden regime index 0–5; available for training and synthetic verification only. |
| `truth_mm` | Generated daily observed rainfall in mm. |
| `raw_mm` | Generated uncorrected forecast rainfall in mm. |
| `moisture` | Dimensionless synthetic moisture predictor. |
| `wind` | Dimensionless synthetic low-level wind predictor. |
| `mslp` | Dimensionless synthetic sea-level pressure anomaly predictor. |
| `terrain_m` | Generated terrain height in metres. |
| `coast_km` | Generated distance to coast in kilometres. |
| `lat`, `lon` | District polygon centroid in degrees. |

The SQLite `districts` table adds `district`, `state`, `coastal`, and `orographic` labels/flags. District polygons (781 districts, official Survey of India outline for Jammu & Kashmir and Ladakh) are in `backend/data/geo/districts.geojson`, with dissolved state outlines in `states.geojson`; source datta07/INDIAN-SHAPEFILES (MIT), normalised by `backend/data/geo/normalize.py`. The 2025 `forecasts` table adds `corrected_p10`, `corrected_p50` (despite the name, the blended conditional-mean best estimate), `corrected_p90`, `global_p50` (single global correction), `truth_mm` (served as `observed_mm`), `served_mm`, `dominant_regime`, `gate_status`, three `prob_*` exceedance probabilities, and `regime_0` through `regime_5` probabilities. `regime_0` through `regime_5` correspond to Active, Break, Depression, Orographic, Coastal, and Western disturbance.

CSV upload accepts no more than 1,000 rows and requires these numeric columns, in any order: `raw_mm`, `lead`, `day`, `moisture`, `wind`, `mslp`, `terrain_m`, `coast_km`, `lat`, `lon`. `raw_mm` must be nonnegative and `lead` must be 1–5. Upload responses include per-row P10/best/P90 (`p10`, `p50`, `p90`), the dominant regime, the served value, gate status and the three exceedance probabilities. These inputs need the same feature definitions as training; arbitrary real-world CSV data cannot be assumed compatible with the synthetic model.
