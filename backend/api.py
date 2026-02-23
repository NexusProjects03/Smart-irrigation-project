import joblib

model = joblib.load("crop_model.pkl")

@app.route('/api/predict', methods=['POST'])
def predict():
    d = request.json
    features = [[d['N'], d['P'], d['K'], d['temperature'],
                 d['humidity'], d['ph'], d['rainfall']]]
    crop = model.predict(features)[0]
    send_mail("Crop Prediction", f"good Crop: {crop}")
    return jsonify({"crop": crop})
