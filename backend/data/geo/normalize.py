"""Normalize datta07 INDIA_DISTRICTS.geojson properties -> {district, state, district_id}."""
import json, re, sys

src, dst = sys.argv[1], sys.argv[2]

# Source mangles diacritics: > = aa, | = ii, @ = uu (upper), # = uu, \ = ii (mixed case)
DIACRITIC = str.maketrans({">": "A", "|": "I", "@": "U", "#": "u", "\\": "i"})
# Karnataka names are truncated at the first diacritic; dist_code is the Census 2011 code.
KARNATAKA = {"0555": "Belagavi", "0556": "Bagalkot", "0558": "Bidar", "0559": "Raichur",
             "0562": "Dharwad", "0564": "Haveri", "0565": "Ballari", "0567": "Davanagere",
             "0570": "Chikkamagaluru", "0571": "Tumakuru", "0572": "Bengaluru Urban",
             "0574": "Hassan", "0577": "Mysuru", "0578": "Chamarajanagar",
             "0580": "Yadgir", "0581": "Kolar", "0582": "Chikkaballapura",
             "0583": "Bengaluru Rural", "0584": "Ramanagara"}
# Rajasthan abolished 9 of its 2023 districts on 28 Dec 2024; merge each back into its main parent.
# ponytail: whole-district merge; tehsils that went to a second parent (e.g. Neem Ka Thana -> Jhunjhunu) are approximated.
RAJ_2024 = {"Anoopgarh": "Ganganagar", "Dudu": "Jaipur", "Gangapurcity": "Sawai Madhopur",
            "Jaipur(Gramin)": "Jaipur", "Jodhpur Gramin": "Jodhpur", "Kekri": "Ajmer",
            "Neem-Ka-Thana": "Sikar", "Sanchore": "Jalor", "Shahpura": "Bhilwara"}
FIX = {"South 24Parganas": "South 24 Parganas", "Medchal_Malkajgiri": "Medchal-Malkajgiri",
       "Ntr": "NTR"}


def tidy(s):
    s = s.translate(DIACRITIC).replace("&", " and ")
    s = re.sub(r"\s+", " ", s).strip().title()
    s = re.sub(r"\b(And|Of)\b", lambda m: m.group(1).lower(), s)
    return FIX.get(s, s)


fc = json.load(open(src, encoding="utf-8"))
rows = []
for f in fc["features"]:
    p = f["properties"]
    if not p["state"] or not p["district"] or p["district"] == "ISLAND":
        continue  # disputed inter-state slivers + unnamed disputed islands (no district)
    sc = "34" if p["state"] == "PUDUCHERRY" else p["statecode"]  # Yanam mis-coded as 28
    name = KARNATAKA.get(p["dist_code"]) if p["state"] == "KARNATAKA" else None
    name = name or tidy(p["district"])
    if p["state"] == "RAJASTHAN":
        name = RAJ_2024.get(name, name)
    rows.append((int(sc), tidy(p["state"]), name, f["geometry"]))

# Stable id: IN-<LGD state code>-<n>, n = alphabetical rank of district within state.
ids = {}
for sc, st, d, _ in sorted(rows, key=lambda r: (r[0], r[2])):
    ids.setdefault((st, d), f"IN-{sc:02d}-{sum(k[0] == st for k in ids) + 1}")

out = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"district": d, "state": st, "district_id": ids[(st, d)]},
     "geometry": g} for sc, st, d, g in rows]}
json.dump(out, open(dst, "w", encoding="utf-8"), ensure_ascii=False)

bad = [d for _, _, d, _ in rows if re.search(r"[^A-Za-z0-9 .()\-']", d) or len(d) < 3]
assert not bad, bad
print(len(rows), "features,", len(ids), "unique districts,", len({r[1] for r in rows}), "states")
