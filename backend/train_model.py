import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import pickle

# Load dataset
df = pd.read_csv("Crop_dataset.csv")

X = df.drop("crop", axis=1)
y = df["crop"]

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Model
model = RandomForestClassifier(
    n_estimators=200,
    max_depth=None,
    random_state=42
)

model.fit(X_train, y_train)

# Accuracy
pred = model.predict(X_test)
acc = accuracy_score(y_test, pred)

# Save model
with open("ml_model.pkl", "wb") as f:
    pickle.dump(model, f)

print("Model trained successfully")
print("Accuracy:", round(acc * 100, 2), "%")
