"""Recalculate delivered-product diagnostics from the stored held-out forecasts.

No fitting occurs here. The gate was chosen on this same season, so these are
retrospective diagnostics, not an independent evaluation of the gate policy.
"""
import json
import sqlite3
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

from backend.verification.scores import scores


def enrich_report(report, rows):
    truth = rows.truth_mm.to_numpy()
    delivered = rows.served_mm.to_numpy()
    masks = {"Overall": np.ones(len(rows), dtype=bool)}
    masks.update({name: rows.regime_true.to_numpy() == r for r, name in enumerate(report["regimes"])})
    masks.update({f"Lead {lead}": rows.lead.to_numpy() == lead for lead in range(1, 6)})
    report["subset_rows"] = {name: int(mask.sum()) for name, mask in masks.items()}
    report["reliability_by_group"] = {name: {} for name in masks}
    report["delivered_evaluation"] = "Retrospective synthetic 2025 diagnostics. The gate was selected on this same season; independent validation of the delivered policy is still required. Probabilities are unchanged by the rainfall gate."

    ids = pd.Index(rows.district_id.unique())
    district = ids.get_indexer(rows.district_id)
    day, _ = pd.factorize(rows.date.astype(str) + "/" + rows.lead.astype(str))
    coordinates = rows.drop_duplicates("district_id").set_index("district_id").loc[ids][["lat", "lon"]].to_numpy()
    neighbours = cKDTree(coordinates).query(coordinates, k=min(5, len(ids)))[1]
    if neighbours.ndim == 1:
        neighbours = neighbours[:, None]
    for threshold in report["thresholds"]:
        key = str(threshold)
        probability = rows[f"prob_{key.replace('.', '_')}"].to_numpy()
        fractions = []
        for values in (truth, delivered):
            grid = np.zeros((day.max() + 1, len(ids)), dtype=bool)
            grid[day, district] = values >= threshold
            fractions.append({k: grid[:, neighbours[:, :k]].mean(axis=2)[day, district] for k in (1, 3, 5)})
        for name, mask in masks.items():
            result = scores(truth[mask], delivered[mask], probability[mask], threshold)
            result["fss"] = {}
            for k in (1, 3, 5):
                observed, forecast = (f[k][mask] for f in fractions)
                denominator = np.mean(observed * observed + forecast * forecast)
                result["fss"][str(k)] = float(1 - np.mean((observed - forecast) ** 2) / denominator) if denominator else 1.0
            report["scores"][name].setdefault("Delivered", {})[key] = result
            p = probability[mask]
            event = truth[mask] >= threshold
            bins = np.minimum((p * 10).astype(int), 9)
            report["reliability_by_group"][name][key] = [
                {"forecast": float(p[bins == k].mean()), "observed": float(event[bins == k].mean()), "count": int((bins == k).sum())}
                for k in range(10) if np.any(bins == k)
            ]
    return report


if __name__ == "__main__":
    data = Path(__file__).resolve().parents[1] / "data"
    with sqlite3.connect(f"file:{(data / 'monsoonlens.db').as_posix()}?mode=ro", uri=True) as db:
        rows = pd.read_sql_query("SELECT * FROM forecasts", db)
    path = data / "verification.json"
    report = enrich_report(json.loads(path.read_text()), rows)
    path.write_text(json.dumps(report, indent=2))
    packaged = data / "vercel" / "verification.json"
    if packaged.exists():
        packaged.write_text(json.dumps(report, indent=2))
    print(f"Calculated delivered scores and subset reliability for {len(rows):,} forecasts.")
