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
GEO = DATA / "geo"
# Coarse mainland coastline (lon, lat), Kutch -> Kerala -> Sundarbans; only used for synthetic coast distance.
COAST = np.array([(68.4, 23.6), (70.0, 22.4), (72.6, 21.1), (72.8, 19.0), (73.3, 17.0), (73.8, 15.4), (74.8, 12.9),
                  (75.8, 11.2), (76.6, 8.9), (77.5, 8.1), (78.2, 8.9), (79.3, 10.3), (79.8, 11.9), (80.3, 13.1),
                  (80.1, 15.5), (82.3, 16.6), (83.9, 18.0), (85.8, 19.8), (87.0, 21.5), (88.6, 21.6), (89.1, 21.7)])
ISLANDS = {"Andaman and Nicobar Islands", "Lakshadweep"}
HILL_STATES = {"Jammu and Kashmir", "Ladakh", "Himachal Pradesh", "Uttarakhand", "Sikkim", "Arunachal Pradesh",
               "Meghalaya", "Nagaland", "Manipur", "Mizoram"}


def _centroid(geometry):
    """Area-weighted centroid of the largest polygon (enough for a synthetic location)."""
    polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
    ring = np.asarray(max(polygons, key=lambda poly: len(poly[0]))[0])
    x, y = ring[:, 0], ring[:, 1]
    cross = x[:-1] * y[1:] - x[1:] * y[:-1]
    area = cross.sum() / 2
    if abs(area) < 1e-12:
        return float(x.mean()), float(y.mean())
    return float(((x[:-1] + x[1:]) * cross).sum() / (6 * area)), float(((y[:-1] + y[1:]) * cross).sum() / (6 * area))


def _coast_km(lon, lat):
    dense = np.concatenate([np.linspace(a, b, 25) for a, b in zip(COAST[:-1], COAST[1:])])
    return float(np.min(np.hypot((dense[:, 0] - lon) * np.cos(np.radians(lat)), dense[:, 1] - lat)) * 111)


def _smooth_field(lon, lat, days, rng, waves=8):
    """Unit-variance random field per day, smooth over ~3-9 degrees (sum of random plane waves)."""
    k = 2 * np.pi / rng.uniform(3, 9, (days, waves))
    theta = rng.uniform(0, 2 * np.pi, (days, waves))
    phase = rng.uniform(0, 2 * np.pi, (days, waves))
    arg = lon[:, None, None] * (k * np.cos(theta)) + lat[:, None, None] * (k * np.sin(theta)) + phase
    return np.sqrt(2 / waves) * np.cos(arg).sum(axis=2)  # (districts, days)


def load_districts(count=None):
    """Real district names and centroids from the bundled boundary file; `count` keeps an even subset."""
    features = json.loads((GEO / "districts.geojson").read_text(encoding="utf-8"))["features"]
    if count and count < len(features):
        features = [features[i] for i in np.linspace(0, len(features) - 1, count).round().astype(int)]
    return features


def generate(count: int | None = None) -> pd.DataFrame:
    cfg = yaml.safe_load((ROOT / "config/settings.yaml").read_text())
    count = count or cfg.get("district_count")
    rng = np.random.default_rng(cfg["seed"])
    districts = []
    for feature in load_districts(count):
        props = feature["properties"]
        lon, lat = _centroid(feature["geometry"])
        coast_km = 5.0 if props["state"] in ISLANDS else _coast_km(lon, lat)
        coast = coast_km < 120
        ghats = coast_km < 160 and lon < 77.6 and lat < 21.5
        mountain = props["state"] in HILL_STATES or ghats
        # Synthetic monsoon climatology: wet west coast and north-east, dry north-west and Tamil Nadu interior.
        wet = 1.0 * (1.45 if ghats else 1) * (1.35 if lon > 89 else 1) * (0.45 if lon < 76 and 23 < lat < 31 else 1) * (0.6 if lat < 13.5 and lon > 77.5 and props["state"] not in ISLANDS else 1)
        districts.append(dict(district_id=props["district_id"], district=props["district"], state=props["state"], lat=lat, lon=lon,
                              terrain_m=float(rng.uniform(600, 2600) if props["state"] in HILL_STATES else rng.uniform(350, 1200) if ghats else rng.uniform(20, 450)),
                              coast_km=coast_km, coastal=int(coast), orographic=int(mountain), wet=wet))
    count = len(districts)
    dist = pd.DataFrame(districts)
    dates = pd.DatetimeIndex(np.concatenate([pd.date_range(f"{year}-06-01", f"{year}-09-30").values for year in cfg["seasons"]]))
    n, days = count, len(dates)
    # Daily large-scale spells plus district geography; latent labels are only training truth.
    daily = np.zeros(days, dtype=int)
    for t in range(1, days):
        daily[t] = daily[t-1] if rng.random() < 0.72 else rng.choice([0, 1, 2, 5], p=[.47, .28, .17, .08])
    daily[daily == 5] = 0
    # Western disturbances are a separate mid-latitude process that reaches the north on some days.
    wd = np.zeros(days, dtype=bool)
    for t in range(1, days):
        wd[t] = rng.random() < (.75 if wd[t-1] else .07)
    local = np.tile(daily, (n, 1))
    for i, d in enumerate(districts):
        # Depressions track the central/east monsoon trough; western disturbances reach only the north.
        if not (17 <= d["lat"] <= 27 and d["lon"] >= 74):
            local[i, local[i] == 2] = 0
        if d["lat"] >= 28.5:
            local[i, wd] = 5
        overrides = rng.random(days)
        local[i, (overrides < .18) & (d["orographic"] == 1)] = 3
        local[i, (overrides >= .18) & (overrides < .34) & (d["coastal"] == 1)] = 4
    regime = local.reshape(-1)
    district_idx = np.repeat(np.arange(n), days)
    date_idx = np.tile(np.arange(days), n)
    means = np.array([27, 5, 67, 48, 37, 17])[regime]
    means = means * (1 + .18 * dist.orographic.to_numpy()[district_idx]) * dist.wet.to_numpy()[district_idx]
    # Spatially coherent rain: a smooth daily field modulates the regime mean, so neighbours rain together.
    lon, lat = dist.lon.to_numpy(), dist.lat.to_numpy()
    field = _smooth_field(lon, lat, days, rng).reshape(-1)
    truth = rng.gamma(2.0, means * np.exp(.55 * field - .151) / 2.0)
    truth[(field < -1.2) | (rng.random(len(truth)) < .08)] *= .12
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
        # NWP error is itself spatially coherent (displaced systems) and grows with lead.
        error_field = _smooth_field(lon, lat, days, rng).reshape(-1)
        frame["raw_mm"] = np.maximum(0, truth * bias[regime] * np.exp((.2 + .08 * lead) * error_field) + rng.normal(1.5 * lead, 4 + 2 * lead, len(truth)))
        records.append(frame)
    result = pd.concat(records, ignore_index=True)
    DATA.mkdir(parents=True, exist_ok=True)
    result.to_parquet(DATA / "synthetic.parquet", index=False)
    with sqlite3.connect(DATA / "monsoonlens.db") as db:
        dist.drop(columns="wet").to_sql("districts", db, if_exists="replace", index=False)
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS ix_district_id ON districts(district_id)")
    print(f"Generated {len(result):,} forecast rows for {count} districts")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--districts", type=int)
    generate(parser.parse_args().districts)
