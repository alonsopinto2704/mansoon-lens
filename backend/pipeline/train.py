"""Train on 2021–23, calibrate on 2024, and verify once on 2025."""
from pathlib import Path
import json
import sqlite3

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
from scipy.spatial import cKDTree

from backend.data.generate_synthetic import DATA, REGIMES
from backend.verification.scores import gate, scores

FEATURES = ["raw_mm", "lead", "day", "moisture", "wind", "mslp", "terrain_m", "coast_km", "lat", "lon"]
# The global baseline is one statistical correction of raw rainfall per lead, as in operational bias correction.
GLOBAL_FEATURES = ["raw_mm", "lead"]
QUANTILES = [.1, .5, .9]
THRESHOLDS = [64.5, 115.6, 204.5]


def _fit_quantiles(x, y, prefix, weight=None):
    models = []
    for q in QUANTILES:
        # The middle member is the conditional mean (L2), the RMSE-optimal point forecast; the outer two bound the P10–P90 range.
        objective = {"objective": "regression"} if q == .5 else {"objective": "quantile", "alpha": q}
        model = lgb.LGBMRegressor(**objective, n_estimators=90, num_leaves=23, learning_rate=.07, verbosity=-1, n_jobs=4)
        model.fit(x, y, sample_weight=weight)
        models.append(model)
    return models


def _predict_quantiles(models, x):
    values = np.stack([np.maximum(0, m.predict(x)) for m in models], axis=1)
    return np.sort(values, axis=1)


def with_regimes(x, probabilities):
    """Exceedance features: predictors plus the six calibrated regime probabilities."""
    return np.hstack([np.asarray(x, dtype=float), probabilities])


def train():
    data = pd.read_parquet(DATA / "synthetic.parquet")
    train_df = data[data.season <= 2023].sample(frac=1, random_state=26080).head(150000)
    valid = data[data.season == 2024].copy()
    test = data[data.season == 2025].copy()
    del data  # the full multi-season frame is not needed after the split
    x_train, x_valid, x_test = (d[FEATURES] for d in (train_df, valid, test))
    classifier = lgb.LGBMClassifier(n_estimators=90, num_leaves=17, learning_rate=.07, verbosity=-1, n_jobs=4)
    classifier.fit(x_train, train_df.regime_true)
    base_class = LogisticRegression(max_iter=300)
    base_class.fit(x_train, train_df.regime_true)
    p_valid_raw = classifier.predict_proba(x_valid)
    # Per-class Platt calibration on the validation season, then normalize simplex.
    calibrators = [LogisticRegression().fit(p_valid_raw[:, r:r+1], (valid.regime_true.to_numpy() == r).astype(int)) for r in range(6)]

    def calibrated(x):
        raw = classifier.predict_proba(x)
        p = np.stack([m.predict_proba(raw[:, r:r+1])[:, 1] for r, m in enumerate(calibrators)], axis=1)
        return p / p.sum(axis=1, keepdims=True)

    p_test = calibrated(x_test)
    global_models = _fit_quantiles(x_train[GLOBAL_FEATURES], train_df.truth_mm, "global")
    # Soft assignment: each regime's model sees every training row weighted by that regime's calibrated
    # probability, matching how the models are blended at prediction time.
    p_train = calibrated(x_train)
    regime_models = [_fit_quantiles(x_train, train_df.truth_mm, REGIMES[r], weight=p_train[:, r] + 1e-3) for r in range(6)]

    def predictions(x):
        probabilities = calibrated(x)
        global_q = _predict_quantiles(global_models, x[GLOBAL_FEATURES])
        regime_q = np.stack([_predict_quantiles(models, x) for models in regime_models], axis=1)
        blended = np.sum(regime_q * probabilities[:, :, None], axis=1)
        return probabilities, global_q, np.sort(blended, axis=1)

    valid_prob, valid_global_q, valid_q = predictions(x_valid)
    _, global_q, corrected_q = predictions(x_test)
    # Tune a single Active-rainfall intercept on the validation season only.
    # It corrects median underprediction near the 64.5 mm event threshold.
    active_valid = valid.regime_true.to_numpy() == 0
    valid_truth = valid.truth_mm.to_numpy()[active_valid]
    valid_raw = valid.raw_mm.to_numpy()[active_valid]
    valid_global = valid_global_q[active_valid, 1]
    bound = min(scores(valid_truth, valid_raw)["rmse"], scores(valid_truth, valid_global)["rmse"])
    candidates = []
    for offset in np.arange(-6, 13, 2):
        candidate = np.maximum(0, valid_q[active_valid, 1] + offset * valid_prob[active_valid, 0])
        metric = scores(valid_truth, candidate)
        if metric["rmse"] < bound:
            candidates.append((metric["csi"] or 0, -metric["rmse"], float(offset)))
    active_offset = max(candidates)[2] if candidates else 0.0
    corrected_q = np.sort(np.maximum(0, corrected_q + active_offset * p_test[:, 0, None]), axis=1)
    # Regime-aware exceedance classifiers (regime probabilities are inputs), calibrated on validation only.
    ex_train, ex_valid, ex_test = with_regimes(x_train, calibrated(x_train)), with_regimes(x_valid, valid_prob), with_regimes(x_test, p_test)
    exceedance_models = []
    exceedance_calibrators = []
    for threshold in THRESHOLDS:
        event_train = (train_df.truth_mm >= threshold).astype(int)
        model = lgb.LGBMClassifier(n_estimators=70, num_leaves=11, learning_rate=.07, verbosity=-1, n_jobs=4, class_weight="balanced")
        model.fit(ex_train, event_train)
        raw_valid = model.predict_proba(ex_valid)[:, 1].reshape(-1, 1)
        cal = LogisticRegression().fit(raw_valid, (valid.truth_mm >= threshold).astype(int))
        exceedance_models.append(model)
        exceedance_calibrators.append(cal)
    exceedance = np.stack([cal.predict_proba(model.predict_proba(ex_test)[:, 1].reshape(-1, 1))[:, 1] for model, cal in zip(exceedance_models, exceedance_calibrators)], axis=1)
    labels = np.argmax(p_test, axis=1)
    matrix = confusion_matrix(test.regime_true, labels, labels=list(range(6))).tolist()
    precision, recall, _, support = precision_recall_fscore_support(test.regime_true, labels, labels=list(range(6)), zero_division=0)
    report = {"training_rows": len(train_df), "validation_rows": len(valid), "test_rows": len(test), "regimes": REGIMES, "thresholds": THRESHOLDS, "active_offset_mm": active_offset,
              "classifier": {"confusion_matrix": matrix, "per_regime": [{"regime": name, "precision": float(precision[r]), "recall": float(recall[r]), "support": int(support[r])} for r, name in enumerate(REGIMES)]}, "scores": {}, "gate": {}}
    truth = test.truth_mm.to_numpy()
    raw = test.raw_mm.to_numpy()
    global_mid = global_q[:, 1]
    corrected_mid = corrected_q[:, 1]
    for group_name, mask in [("Overall", np.ones(len(test), dtype=bool))] + [(name, test.regime_true.to_numpy() == r) for r, name in enumerate(REGIMES)] + [(f"Lead {lead}", test.lead.to_numpy() == lead) for lead in range(1, 6)]:
        report["scores"][group_name] = {model: {str(threshold): scores(truth[mask], pred[mask], exceedance[mask, j] if model == "Regime-aware" else None, threshold) for j, threshold in enumerate(THRESHOLDS)} for model, pred in (("Raw", raw), ("Global", global_mid), ("Regime-aware", corrected_mid))}
    # District-neighbour FSS: points are synthetic, so neighbourhoods use
    # nearest district centroids rather than a gridded operational product.
    district_ids = pd.Index(test.district_id.unique())
    district_idx = district_ids.get_indexer(test.district_id)
    day_idx, _ = pd.factorize(test.date.astype(str) + "/" + test.lead.astype(str))
    shape = (day_idx.max() + 1, len(district_ids))
    coordinates = test.drop_duplicates("district_id").set_index("district_id").loc[district_ids][["lat", "lon"]].to_numpy()
    neighbours = cKDTree(coordinates).query(coordinates, k=5)[1]
    score_masks = {"Overall": np.ones(len(test), dtype=bool), **{name: test.regime_true.to_numpy() == r for r, name in enumerate(REGIMES)}, **{f"Lead {lead}": test.lead.to_numpy() == lead for lead in range(1, 6)}}
    for threshold in THRESHOLDS:
        fractions = {}
        for name, values in (("Observed", truth), ("Raw", raw), ("Global", global_mid), ("Regime-aware", corrected_mid)):
            grid = np.zeros(shape, dtype=bool)
            grid[day_idx, district_idx] = values >= threshold
            fractions[name] = {k: grid[:, neighbours[:, :k]].mean(axis=2)[day_idx, district_idx] for k in (1, 3, 5)}
        for group_name, mask in score_masks.items():
            for name in ("Raw", "Global", "Regime-aware"):
                report["scores"][group_name][name][str(threshold)]["fss"] = {}
                for k in (1, 3, 5):
                    o, f = fractions["Observed"][k][mask], fractions[name][k][mask]
                    denominator = np.mean(o * o + f * f)
                    report["scores"][group_name][name][str(threshold)]["fss"][str(k)] = float(1 - np.mean((o-f)**2) / denominator) if denominator else 1.0
    weeks = pd.to_datetime(test.date).dt.isocalendar().week.to_numpy()
    for r, name in enumerate(REGIMES):
        mask = test.regime_true.to_numpy() == r
        report["gate"][name] = gate(truth[mask], raw[mask], global_mid[mask], corrected_mid[mask], weeks[mask], repetitions=100)
    report["reliability"] = {}
    for j, threshold in enumerate(THRESHOLDS):
        observed = (truth >= threshold).astype(float)
        bins = np.minimum((exceedance[:, j] * 10).astype(int), 9)
        report["reliability"][str(threshold)] = [{"forecast": float(exceedance[bins == k, j].mean()), "observed": float(observed[bins == k].mean()), "count": int(np.sum(bins == k))} for k in range(10) if np.any(bins == k)]
    DATA.joinpath("verification.json").write_text(json.dumps(report, indent=2))
    served = np.where(np.array([report["gate"][REGIMES[r]]["status"] == "Corrected" for r in labels]), corrected_mid, raw)
    test["corrected_p10"] = corrected_q[:, 0]
    test["corrected_p50"] = corrected_mid
    test["corrected_p90"] = corrected_q[:, 2]
    test["global_p50"] = global_mid
    test["served_mm"] = served
    test["dominant_regime"] = [REGIMES[r] for r in labels]
    test["gate_status"] = [report["gate"][REGIMES[r]]["status"] for r in labels]
    for j, threshold in enumerate(THRESHOLDS):
        test[f"prob_{str(threshold).replace('.', '_')}"] = exceedance[:, j]
    for r, name in enumerate(REGIMES):
        test[f"regime_{r}"] = p_test[:, r]
    with sqlite3.connect(DATA / "monsoonlens.db") as db:
        test.to_sql("forecasts", db, if_exists="replace", index=False, chunksize=3000)
        db.execute("CREATE INDEX ix_forecast_date_lead ON forecasts(date, lead)")
        db.execute("CREATE INDEX ix_forecast_district ON forecasts(district_id, date, lead)")
    joblib.dump({"classifier": classifier, "calibrators": calibrators, "global": global_models, "regime": regime_models, "exceedance": exceedance_models, "exceedance_calibrators": exceedance_calibrators, "active_offset_mm": active_offset}, DATA / "models.joblib")
    print("Trained and verified:", len(test), "held-out rows; gates:", {r: v["status"] for r, v in report["gate"].items()})


if __name__ == "__main__":
    train()
