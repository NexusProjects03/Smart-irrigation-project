import pandas as pd
import random

crops = {
    "Rice": {
        "N": (180, 260), "P": (60, 120), "K": (150, 220),
        "temp": (24, 32), "moist": (60, 85), "ph": (5.8, 7.0)
    },
    "Wheat": {
        "N": (100, 160), "P": (40, 80), "K": (50, 120),
        "temp": (18, 26), "moist": (35, 55), "ph": (6.0, 7.5)
    },
    "Maize": {
        "N": (120, 200), "P": (50, 100), "K": (80, 150),
        "temp": (22, 30), "moist": (40, 60), "ph": (5.5, 7.0)
    },
    "Cotton": {
        "N": (140, 220), "P": (50, 110), "K": (100, 180),
        "temp": (25, 35), "moist": (45, 65), "ph": (5.8, 7.2)
    },
    "Sugarcane": {
        "N": (180, 300), "P": (70, 140), "K": (160, 250),
        "temp": (26, 38), "moist": (65, 85), "ph": (6.0, 7.5)
    }
}

rows = []

for crop, r in crops.items():
    for _ in range(400):  # 400 rows per crop → 2000 rows total
        rows.append({
            "N": random.randint(*r["N"]),
            "P": random.randint(*r["P"]),
            "K": random.randint(*r["K"]),
            "temperature": round(random.uniform(*r["temp"]), 1),
            "soil_moisture": round(random.uniform(*r["moist"]), 1),
            "ph": round(random.uniform(*r["ph"]), 2),
            "crop": crop
        })

df = pd.DataFrame(rows)
df.to_csv("Crop_dataset.csv", index=False)

print("✅ Crop_dataset.csv created with", len(df), "rows")
