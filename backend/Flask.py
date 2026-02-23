from flask import Flask, request, jsonify
from flask_cors import CORS
import smtplib

app = Flask(__name__)
CORS(app)

PUMP_THRESHOLD = 35

@app.route('/api/sensor-data', methods=['POST'])
def sensor_data():
    data = request.json
    moisture = data['moisture']
    
    pump = "OFF"
    if moisture < PUMP_THRESHOLD:
        pump = "ON"
        send_mail("Pump ON", "Soil moisture low")

    return jsonify({"pump": pump})

def send_mail(subject, msg):
    server = smtplib.SMTP('smtp.gmail.com', 587)
    server.starttls()
    server.login("YOUR_EMAIL@gmail.com", "APP_PASSWORD")
    message = f"Subject:{subject}\n\n{msg}"
    server.sendmail("YOUR_EMAIL@gmail.com","USER_EMAIL@gmail.com", message)
    server.quit()

app.run(host="0.0.0.0", port=5000)
