from pathlib import Path
import pandas as pd


def validate(path: Path) -> None:
    data = pd.read_parquet(path)
    assert not data.isna().any().any(), "Synthetic dataset has missing values"
    assert (data[["truth_mm", "raw_mm"]] >= 0).all().all(), "Negative rainfall"
    assert data.lead.between(1, 5).all(), "Invalid lead day"
    assert data.regime_true.between(0, 5).all(), "Invalid regime"
    assert data.duplicated(["district_id", "date", "lead"]).sum() == 0, "Duplicate key"
    print(f"Validated {len(data):,} rows")


if __name__ == "__main__":
    validate(Path(__file__).with_name("synthetic.parquet"))
