"""Seeded synthetic district-day rainfall and forecast pairs."""
from pathlib import Path
import argparse
import json
import sqlite3

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent
REGIMES = ["Active", "Break", "Depression", "Orographic", "Coastal", "Western disturbance"]
STATES = [
    ("Kerala", 9.9, 76.5), ("Karnataka", 14.8, 75.4), ("Maharashtra", 19.4, 75.2),
    ("Goa", 15.4, 73.9), ("Gujarat", 22.7, 72.7), ("Rajasthan", 26.4, 74.3),
    ("Punjab", 31.0, 75.4), ("Himachal Pradesh", 31.8, 77.2),
    ("Uttar Pradesh", 26.7, 80.9), ("Bihar", 25.8, 85.7),
    ("West Bengal", 23.3, 87.8), ("Odisha", 20.2, 85.8),
    ("Andhra Pradesh", 16.2, 80.8), ("Tamil Nadu", 11.1, 78.3),
    ("Madhya Pradesh", 23.5, 78.6), ("Chhattisgarh", 21.4, 82.1),
    ("Assam", 26.2, 92.9), ("Meghalaya", 25.5, 91.4),
    ("Jharkhand", 23.6, 85.3), ("Telangana", 18.0, 79.3),
]
NAMES = {
    "Kerala": ["Alappuzha", "Ernakulam", "Kozhikode"],
    "Karnataka": ["Udupi", "Dakshina Kannada", "Mysuru"],
    "Maharashtra": ["Pune", "Mumbai", "Ratnagiri"],
    "Goa": ["North Goa", "South Goa"], "Gujarat": ["Surat", "Valsad", "Ahmedabad"],
    "Rajasthan": ["Jaipur", "Udaipur", "Jodhpur"], "Punjab": ["Amritsar", "Ludhiana", "Patiala"],
    "Himachal Pradesh": ["Shimla", "Kullu", "Mandi"],
    "Uttar Pradesh": ["Lucknow", "Varanasi", "Prayagraj"], "Bihar": ["Patna", "Gaya", "Muzaffarpur"],
    "West Bengal": ["Kolkata", "Darjeeling", "Howrah"], "Odisha": ["Bhubaneswar", "Cuttack", "Puri"],
    "Andhra Pradesh": ["Visakhapatnam", "Guntur", "Nellore"], "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai"],
    "Madhya Pradesh": ["Bhopal", "Indore", "Jabalpur"], "Chhattisgarh": ["Raipur", "Bilaspur", "Durg"],
    "Assam": ["Guwahati", "Dibrugarh", "Jorhat"], "Meghalaya": ["Shillong", "Tura", "Jowai"],
    "Jharkhand": ["Ranchi", "Dhanbad", "Bokaro"], "Telangana": ["Hyderabad", "Warangal", "Nizamabad"],
}


def generate(count: int | None = None) -> pd.DataFrame:
    cfg = yaml.safe_load((ROOT / "config/settings.yaml").read_text())
    count = count or cfg["district_count"]
    rng = np.random.default_rng(cfg["seed"])
    districts = []
    for i in range(count):
        state, lat, lon = STATES[i % len(STATES)]
        lat = float(np.clip(lat + rng.normal(0, 0.55), 8, 36))
        lon = float(np.clip(lon + rng.normal(0, 0.65), 68, 98))
        coast = state in {"Kerala", "Karnataka", "Maharashtra", "Goa", "Gujarat", "West Bengal", "Odisha", "Andhra Pradesh", "Tamil Nadu"}
        mountain = state in {"Kerala", "Karnataka", "Maharashtra", "Himachal Pradesh", "Meghalaya"}
        district_number = i // len(STATES)
        district_name = NAMES[state][district_number] if district_number < len(NAMES[state]) else f"{state} district {district_number+1}"
        districts.append(dict(district_id=f"D{i+1:04d}", district=district_name, state=state, lat=lat, lon=lon, terrain_m=float(rng.uniform(350, 1900) if mountain else rng.uniform(20, 400)), coast_km=float(rng.uniform(5, 90) if coast else rng.uniform(100, 850)), coastal=int(coast), orographic=int(mountain)))
    dist = pd.DataFrame(districts)
    dates = pd.DatetimeIndex(np.concatenate([pd.date_range(f"{year}-06-01", f"{year}-09-30").values for year in cfg["seasons"]]))
    n, days = count, len(dates)
    # Daily large-scale spells plus district geography; latent labels are only training truth.
    daily = np.zeros(days, dtype=int)
    for t in range(1, days):
        daily[t] = daily[t-1] if rng.random() < 0.72 else rng.choice([0, 1, 2, 5], p=[.47, .28, .17, .08])
    local = np.tile(daily, (n, 1))
    for i, d in enumerate(districts):
        overrides = rng.random(days)
        local[i, (overrides < .18) & (d["orographic"] == 1)] = 3
        local[i, (overrides >= .18) & (overrides < .34) & (d["coastal"] == 1)] = 4
    regime = local.reshape(-1)
    district_idx = np.repeat(np.arange(n), days)
    date_idx = np.tile(np.arange(days), n)
    means = np.array([27, 5, 67, 48, 37, 17])[regime]
    means = means * (1 + .18 * dist.orographic.to_numpy()[district_idx])
    truth = rng.gamma(1.35, means / 1.35)
    truth[rng.random(len(truth)) < .21] *= .12
    extreme = rng.random(len(truth)) < .004
    truth[extreme] += rng.exponential(90, extreme.sum())
    moisture = np.array([.9, -.8, 1.3, .6, .7, -.2])[regime] + rng.normal(0, .75, len(regime))
    wind = np.array([.7, -.5, 1.5, 1.0, .9, .1])[regime] + rng.normal(0, .7, len(regime))
    mslp = np.array([-.5, .7, -1.5, -.2, -.5, -.2])[regime] + rng.normal(0, .65, len(regime))
    base = pd.DataFrame({"district_id": dist.district_id.to_numpy()[district_idx], "date": dates.date.astype(str)[date_idx], "season": dates.year.to_numpy()[date_idx], "day": dates.dayofyear.to_numpy()[date_idx], "regime_true": regime, "truth_mm": truth, "moisture": moisture, "wind": wind, "mslp": mslp, "terrain_m": dist.terrain_m.to_numpy()[district_idx], "coast_km": dist.coast_km.to_numpy()[district_idx], "lat": dist.lat.to_numpy()[district_idx], "lon": dist.lon.to_numpy()[district_idx]})
    records = []
    bias = np.array([.72, 1.52, .58, .70, 1.28, .88])
    for lead in cfg["lead_days"]:
        frame = base.copy()
        frame["lead"] = lead
        frame["raw_mm"] = np.maximum(0, truth * bias[regime] + rng.normal(1.5 * lead, 7 + 2.5 * lead, len(truth)))
        records.append(frame)
    result = pd.concat(records, ignore_index=True)
    DATA.mkdir(parents=True, exist_ok=True)
    result.to_parquet(DATA / "synthetic.parquet", index=False)
    with sqlite3.connect(DATA / "monsoonlens.db") as db:
        dist.to_sql("districts", db, if_exists="replace", index=False)
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_district_id ON districts(district_id)")
    (DATA / "districts.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"district_id": r["district_id"], "district": r["district"], "state": r["state"]}, "geometry": {"type": "Point", "coordinates": [r["lon"], r["lat"]]}} for r in districts]}))
    print(f"Generated {len(result):,} forecast rows and {count} district points")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--districts", type=int)
    generate(parser.parse_args().districts)
