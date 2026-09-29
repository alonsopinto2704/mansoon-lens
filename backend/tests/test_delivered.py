import numpy as np
import pandas as pd
from backend.verification.delivered import enrich_report


def test_delivered_scores_follow_served_values_and_subset_reliability():
    # Perfect corrected values must not leak into the score when raw was served.
    rows = pd.DataFrame([
        dict(district_id=str(r), date="2025-06-01", lead=lead, lat=r, lon=r,
             regime_true=r, truth_mm=100 * r, served_mm=0, corrected_p50=100 * r,
             prob_64_5=.1 + .8 * r)
        for lead in range(1, 6) for r in range(2)
    ])
    report = {"regimes": ["Dry", "Wet"], "thresholds": [64.5],
              "scores": {name: {} for name in ["Overall", "Dry", "Wet"] + [f"Lead {n}" for n in range(1, 6)]}}
    enrich_report(report, rows)
    overall = report["scores"]["Overall"]["Delivered"]["64.5"]
    assert np.isclose(overall["rmse"], np.sqrt(5000))
    assert overall["misses"] == 5 and overall["hits"] == 0
    assert overall["fss"]["1"] == 0
    assert report["subset_rows"]["Lead 2"] == 2
    for group, count in report["subset_rows"].items():
        assert sum(b["count"] for b in report["reliability_by_group"][group]["64.5"]) == count
    assert report["reliability_by_group"]["Wet"]["64.5"][0]["observed"] == 1
    assert report["reliability_by_group"]["Dry"]["64.5"][0]["observed"] == 0
