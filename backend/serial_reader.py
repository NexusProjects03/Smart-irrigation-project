import serial
import json
import time
import requests

# CHANGE THIS
PORT = "COM3"        # Windows example
# PORT = "/dev/ttyUSB0"  # Linux
# PORT = "/dev/ttyACM0"  # Arduino on Linux/Mac

BAUD = 9600
SERVER_URL = "http://127.0.0.1:5000/api/sensor-data"

ser = serial.Serial(PORT, BAUD, timeout=1)
time.sleep(2)

print("Serial reader started...")

while True:
    try:
        line = ser.readline().decode("utf-8").strip()
        if line:
            data = json.loads(line)
            print("Received:", data)

            # Send to Flask backend
            requests.post(SERVER_URL, json=data)

    except Exception as e:
        print("Error:", e)
