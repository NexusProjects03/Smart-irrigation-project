from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import json, os, threading, time
import serial
import pickle
from dotenv import load_dotenv

load_dotenv()

model = pickle.load(open("ml_model.pkl", "rb"))

# ================= PATHS =================
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
CROPS_FILE = os.path.join(os.path.dirname(__file__), "crops.json")

# ================= FLASK =================
import requests

# ================= FLASK =================
app = Flask(__name__)
CORS(app)

# ================= AI CONFIG =================
AI_API_KEY = os.getenv("AI_API_KEY")
AI_MODEL = "openai/gpt-oss-20b:free"  # Using user's requested model
AI_URL = "https://openrouter.ai/api/v1/chat/completions"

# ================= RESEND EMAIL CONFIG =================
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
RESEND_URL = "https://api.resend.com/emails"
ALERT_EMAILS = [email.strip() for email in os.getenv("ALERT_EMAILS", "").split(",")]
EMAIL_COOLDOWN = 300  # 5 minutes in seconds
last_email_time = 0  # Track last email sent time
last_alert_type = None  # Track what type of alert was sent

# ================= MOTOR STATUS =================
motor_status = "offline"  # "online" or "offline"

def send_moisture_alert(alert_type, moisture_value):
    """Send email alert via Resend API"""
    global last_email_time, last_alert_type
    
    current_time = time.time()
    
    # Check cooldown (5 minutes)
    if current_time - last_email_time < EMAIL_COOLDOWN and last_alert_type == alert_type:
        print(f"Email cooldown active. Skipping {alert_type} alert.")
        return False
    
    if alert_type == "dry":
        subject = "ALERT: Soil Too Dry - Immediate Action Required"
        html_content = f"""
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #fff3cd; border-radius: 10px;">
            <h2 style="color: #856404;">Soil Moisture Critical Alert</h2>
            <p style="font-size: 18px;">Your soil moisture has dropped to <strong>{moisture_value}%</strong></p>
            <p style="color: #721c24; font-size: 16px;">
                The soil is too dry to support healthy plant growth. 
                Your crops may be at risk of wilting or dying.
            </p>
            <h3>Recommended Actions:</h3>
            <ul>
                <li>Turn on irrigation/water pump immediately</li>
                <li>Check for any leaks in the irrigation system</li>
                <li>Consider adding mulch to retain moisture</li>
            </ul>
            <p style="color: #6c757d; font-size: 12px;">Alert from Smart Agriculture System</p>
        </div>
        """
    else:  # wet
        subject = "ALERT: Soil Too Wet - Over-watering Detected"
        html_content = f"""
        <div style="font-family: Arial, sans-serif; padding: 20px; background: #cce5ff; border-radius: 10px;">
            <h2 style="color: #004085;">Soil Moisture Critical Alert</h2>
            <p style="font-size: 18px;">Your soil moisture has reached <strong>{moisture_value}%</strong></p>
            <p style="color: #721c24; font-size: 16px;">
                The soil is over-saturated with water. 
                This can lead to root rot and kill your crops.
            </p>
            <h3>Recommended Actions:</h3>
            <ul>
                <li>Turn off irrigation/water pump immediately</li>
                <li>Ensure proper drainage in the field</li>
                <li>Check for blocked drainage channels</li>
            </ul>
            <p style="color: #6c757d; font-size: 12px;">Alert from Smart Agriculture System</p>
        </div>
        """
    
    try:
        response = requests.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {RESEND_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "from": "Smart Agriculture <onboarding@resend.dev>",
                "to": ALERT_EMAILS,
                "subject": subject,
                "html": html_content
            }
        )
        
        if response.status_code == 200:
            print(f"Alert email sent successfully: {alert_type}")
            last_email_time = current_time
            last_alert_type = alert_type
            return True
        else:
            print(f"Email send failed: {response.status_code} - {response.text}")
            return False
            
    except Exception as e:
        print(f"Email error: {e}")
        return False

def check_moisture_and_alert(moisture):
    """Check moisture levels and trigger alerts if needed"""
    # Only proceed if moisture is a valid number greater than 0
    if moisture is None or not isinstance(moisture, (int, float)) or moisture <= 0:
        return
    
    if moisture <= 20:
        send_moisture_alert("dry", moisture)
    elif moisture >= 90:
        send_moisture_alert("wet", moisture)

def send_ai_search_email(crop_name, analysis, crop_data):
    """Send email with AI search results"""
    try:
        subject = f"Crop Analysis Search: {crop_name}"
        html_content = f"""
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #2E7D32;">🌱 New AI Crop Search</h2>
            <p><strong>User searched for:</strong> {crop_name}</p>
            
            <div style="background: #f8f9fa; padding: 15px; border-radius: 5px; margin: 15px 0;">
                <h3 style="margin-top:0;">AI Advice & Analysis:</h3>
                <p style="line-height: 1.5; color: #444;">{analysis}</p>
            </div>
            
            <h3>Ideal Conditions Generated:</h3>
            <ul>
                <li><strong>Nitrogen (N):</strong> {crop_data.get('N_min')} - {crop_data.get('N_max')} mg/kg</li>
                <li><strong>Phosphorus (P):</strong> {crop_data.get('P_min')} - {crop_data.get('P_max')} mg/kg</li>
                <li><strong>Potassium (K):</strong> {crop_data.get('K_min')} - {crop_data.get('K_max')} mg/kg</li>
                <li><strong>pH:</strong> {crop_data.get('ph_min')} - {crop_data.get('ph_max')}</li>
                <li><strong>Temperature:</strong> {crop_data.get('temp_min')} - {crop_data.get('temp_max')} °C</li>
            </ul>
        </div>
        """
        
        response = requests.post(
            RESEND_URL,
            headers={"Authorization": f"Bearer {RESEND_API_KEY}", "Content-Type": "application/json"},
            json={
                "from": "Smart Agriculture <onboarding@resend.dev>",
                "to": ALERT_EMAILS,
                "subject": subject,
                "html": html_content
            }
        )
        if response.status_code == 200:
            print(f"✅ AI Search email sent for {crop_name}")
        else:
            print(f"❌ Email Failed: {response.status_code}")
            print(f"Reason: {response.text}")
    except Exception as e:
        print(f"❌ Failed to send AI email: {e}")

def get_ai_crop_data(crop_name):
    """
    Asks AI for crop data and compatibility analysis.
    """
    global latest_sensor
    
    # Construct the prompt - sensor data is optional
    has_sensor_data = bool(latest_sensor and latest_sensor.get("N"))
    
    if has_sensor_data:
        sensor_info = f"""
Current Sensor Readings:
- Nitrogen (N): {latest_sensor.get('N', 'N/A')} mg/kg
- Phosphorus (P): {latest_sensor.get('P', 'N/A')} mg/kg  
- Potassium (K): {latest_sensor.get('K', 'N/A')} mg/kg
- pH: {latest_sensor.get('ph', 'N/A')}
- Temperature: {latest_sensor.get('temperature', 'N/A')} °C
- Soil Moisture: {latest_sensor.get('soil_moisture', 'N/A')} %
"""
        analysis_instruction = "Compare these readings with the ideal ranges and provide specific advice on what needs adjustment."
    else:
        sensor_info = "No sensor data available (offline mode)."
        analysis_instruction = "Provide general growing advice for this crop."
    
    prompt = f"""You are an agricultural expert. Provide ideal soil and climate conditions for: {crop_name}

{sensor_info}

Return ONLY a valid JSON object (no markdown, no code blocks). Structure:
{{
    "N_min": <integer>,
    "N_max": <integer>,
    "P_min": <integer>,
    "P_max": <integer>,
    "K_min": <integer>,
    "K_max": <integer>,
    "ph_min": <float>,
    "ph_max": <float>,
    "temp_min": <float>,
    "temp_max": <float>,
    "moist_min": <float>,
    "moist_max": <float>,
    "analysis": "<string: {analysis_instruction}>"
}}

Use realistic agricultural data for {crop_name}."""

    try:
        # Step 1: Request with reasoning enabled
        response1 = requests.post(
            AI_URL,
            headers={
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000", 
                "X-Title": "Smart Agriculture MVP"
            },
            json={
                "model": AI_MODEL,
                "messages": [
                    {"role": "user", "content": prompt}
                ],
                "reasoning": {"enabled": True},
                "provider": {"data_collection": "allow"}
            },
            timeout=40
        )
        
        if response1.status_code != 200:
            print("AI Error Status 1:", response1.status_code)
            print("AI Error Response 1:", response1.text[:500])
            return None

        response1_data = response1.json()
        assistant_message = response1_data['choices'][0]['message']

        # Step 2: Pass reasoning details back to model for final output
        messages = [
            {"role": "user", "content": prompt},
            {
                "role": "assistant",
                "content": assistant_message.get('content', ''),
                "reasoning_details": assistant_message.get('reasoning_details')
            },
            {"role": "user", "content": "Return the final formatted JSON exactly as requested without any markdown or conversational text."}
        ]

        response2 = requests.post(
            AI_URL,
            headers={
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:5000", 
                "X-Title": "Smart Agriculture MVP"
            },
            json={
                "model": AI_MODEL,
                "messages": messages,
                "reasoning": {"enabled": True},
                "provider": {"data_collection": "allow"}
            },
            timeout=40
        )

        if response2.status_code != 200:
            print("AI Error Status 2:", response2.status_code)
            return None
            
        response_json = response2.json()
        print("AI Raw Response:", response_json)
        
        content = response_json['choices'][0]['message']['content']
        print("AI Content (raw):", content)
        
        # More aggressive cleaning of markdown
        content = content.strip()
        if content.startswith("```"):
            # Remove code block markers
            lines = content.split('\n')
            # Remove first line if it's ```json or ```
            if lines[0].startswith("```"):
                lines = lines[1:]
            # Remove last line if it's ```
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            content = '\n'.join(lines).strip()
        
        print("AI Content (cleaned):", content)
        
        try:
            data = json.loads(content)
            print("AI Parsed Data:", data)
            return data
        except json.JSONDecodeError as je:
            print(f"JSON Parse Error: {je}")
            print(f"Failed content: {content[:200]}")
            return None

    except requests.exceptions.RequestException as e:
        print("AI Request Exception Type:", type(e).__name__)
        print("AI Request Exception:", str(e))
        return None
    except Exception as e:
        print("AI Exception Type:", type(e).__name__)
        print("AI Exception:", str(e))
        import traceback
        traceback.print_exc()
        return None

@app.route("/api/ai-add-crop", methods=["POST"])
def ai_add_crop():
    req = request.json
    crop_name = req.get("name")
    
    if not crop_name:
        return jsonify({"error": "Crop name required"}), 400
        
    print(f"AI analyzing crop: {crop_name}...")
    ai_data = get_ai_crop_data(crop_name)
    
    if not ai_data:
        return jsonify({"error": "AI could not retrieve data. Try again."}), 500
        
    # Send email notification about AI search
    send_ai_search_email(crop_name, ai_data.get("analysis", "No analysis"), ai_data)
        
    # Prepare the crop object for storage (Normalizing Min/Max)
    def norm(v1, v2):
        return min(v1, v2), max(v1, v2)

    n_min, n_max = norm(ai_data.get("N_min", 0), ai_data.get("N_max", 0))
    p_min, p_max = norm(ai_data.get("P_min", 0), ai_data.get("P_max", 0))
    k_min, k_max = norm(ai_data.get("K_min", 0), ai_data.get("K_max", 0))
    ph_min, ph_max = norm(ai_data.get("ph_min", 0), ai_data.get("ph_max", 0))
    t_min, t_max = norm(ai_data.get("temp_min", 0), ai_data.get("temp_max", 0))
    m_min, m_max = norm(ai_data.get("moist_min", 0), ai_data.get("moist_max", 0))

    new_crop = {
        "name": crop_name,
        "N_min": n_min, "N_max": n_max,
        "P_min": p_min, "P_max": p_max,
        "K_min": k_min, "K_max": k_max,
        "ph_min": ph_min, "ph_max": ph_max,
        "temp_min": t_min, "temp_max": t_max,
        "moist_min": m_min, "moist_max": m_max,
        "analysis": ai_data.get("analysis", "No AI analysis available.")
    }
    
    # Save to database
    crops = load_crops()
    # Remove existing if overwriting
    crops = [c for c in crops if c["name"].lower() != crop_name.lower()]
    crops.append(new_crop)
    save_crops(crops)
    
    return jsonify({
        "message": "Crop added via AI",
        "crop": new_crop,
        "analysis": ai_data.get("analysis", "No analysis provided.")
    })


# ================= GLOBAL DATA =================
latest_sensor = {}

# ================= SERIAL CONFIG =================
SERIAL_PORT = os.getenv("SERIAL_PORT", "COM3")
BAUD_RATE = 9600

# ================= UTIL =================
def load_crops():
    if not os.path.exists(CROPS_FILE):
        with open(CROPS_FILE, "w") as f:
            json.dump([], f)
    with open(CROPS_FILE, "r") as f:
        return json.load(f)

def save_crops(crops):
    with open(CROPS_FILE, "w") as f:
        json.dump(crops, f, indent=4)

# ================= SERIAL READER =================
def serial_reader():
    global latest_sensor, motor_status
    try:
        ser = serial.Serial(SERIAL_PORT, BAUD_RATE, timeout=1)
        time.sleep(2)
        print("Arduino Serial Connected")

        while True:
            line = ser.readline().decode("utf-8").strip()
            if line:
                try:
                    data = json.loads(line)
                    latest_sensor = data
                    print("Sensor:", latest_sensor)
                    
                    # Update motor status from Arduino data
                    if "motor" in data:
                        motor_status = "online" if data["motor"] == 1 else "offline"
                    
                    # Check moisture and send alerts if needed
                    if "soil_moisture" in data:
                        check_moisture_and_alert(data["soil_moisture"])
                        
                except json.JSONDecodeError:
                    print("Invalid JSON:", line)

    except Exception as e:
        print("Serial Error:", e)
        motor_status = "offline"

# Start Serial Thread
threading.Thread(target=serial_reader, daemon=True).start()

# ================= FRONTEND =================
@app.route("/")
def serve_ui():
    return send_from_directory(FRONTEND_DIR, "index.html")

# Static file serving moved to bottom
# @app.route("/<path:path>") moved down

# ================= TEST =================
@app.route("/test")
def test():
    return "Backend + Arduino + Frontend Connected OK"

# ================= SENSOR API =================
@app.route("/api/config", methods=["GET"])
def get_config():
    return jsonify({
        "FIREBASE_AUTH": os.getenv("FIREBASE_AUTH")
    })

@app.route("/api/sensor-data", methods=["GET"])
def sensor_get():
    return jsonify(latest_sensor)

@app.route("/api/connection-status", methods=["GET"])
def connection_status():
    """Check if we have recent sensor data (Arduino connected)"""
    is_connected = bool(latest_sensor and latest_sensor.get("N") is not None)
    return jsonify({"connected": is_connected})

@app.route("/api/motor-status", methods=["GET"])
def get_motor_status():
    """Get motor online/offline status"""
    return jsonify({"status": motor_status})

# ================= CROPS =================
@app.route("/api/crops", methods=["POST"])
def add_crop():
    crops = load_crops()
    crops.append(request.json)
    save_crops(crops)
    return jsonify({"message": "Crop added"})

@app.route("/api/crops", methods=["GET"])
def get_crops():
    return jsonify(load_crops())

# ================= TOGGLE FAVORITE =================
@app.route("/api/toggle-fav", methods=["POST"])
def toggle_fav():
    req = request.get_json(silent=True) or {}
    crop_name = req.get("name", "").strip()
    
    if not crop_name:
        return jsonify({"error": "Crop name required"}), 400
    
    crops = load_crops()
    found = False
    for c in crops:
        if c["name"].strip().lower() == crop_name.lower():
            c["favorite"] = not c.get("favorite", False)
            found = True
            break
    
    if found:
        save_crops(crops)
        return jsonify({"message": "Toggled favorite", "name": crop_name})
    return jsonify({"error": f"Crop '{crop_name}' not found"}), 404

def get_ai_more_crops(sensor_data, existing_crops, count):
    """Ask AI for additional crops to fill the list — single fast call, no reasoning needed"""
    prompt = f"""You are an expert agronomist. Based on these soil conditions:
N={sensor_data.get('N')} mg/kg, P={sensor_data.get('P')} mg/kg, K={sensor_data.get('K')} mg/kg
pH={sensor_data.get('ph')}, Temperature={sensor_data.get('temperature')}°C, Moisture={sensor_data.get('soil_moisture')}%

Already listed: {', '.join(existing_crops[:15])}

Suggest exactly {count} MORE crops suitable for these conditions. Do NOT repeat any listed above.
Return ONLY a JSON array, no markdown, no explanation:
[{{"crop":"CropName","confidence":75,"type":"AI Suggestion"}}]"""
    
    try:
        response = requests.post(
            AI_URL,
            headers={
                "Authorization": f"Bearer {AI_API_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": AI_MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "provider": {"data_collection": "allow"}
            },
            timeout=45
        )
        
        if response.status_code == 200:
            content = response.json()['choices'][0]['message']['content']
            # Clean markdown
            content = content.replace("```json", "").replace("```", "").strip()
            data = json.loads(content)
            # Ensure type is set
            for item in data:
                item["type"] = "AI Suggestion"
            return data
        else:
            print(f"AI More Crops Error: {response.status_code} - {response.text[:200]}")
    except Exception as e:
        print(f"AI Fetch Error: {e}")
    
    return []

# ================= PREDICTION (PRIORITY: FAV -> USER -> ML) =================
@app.route("/api/predict", methods=["POST"])
def predict():
    # Allow frontend to pass data (for Cloud Mode)
    req_data = request.get_json(silent=True) or {}
    
    # Use passed data if valid, else use internal latest_sensor
    if "N" in req_data:
        data = req_data
    else:
        data = latest_sensor

    if not data or "N" not in data:
        return jsonify({"error": "No sensor data received"})

    # Zero-data guard: reject if all NPK are 0
    if float(data.get("N", 0)) == 0 and float(data.get("P", 0)) == 0 and float(data.get("K", 0)) == 0:
        return jsonify({"error": "Sensor readings are all zero. Connect sensors or switch mode."})

    # 1. ML Prediction (Relaxed Logic to fill list)
    import pandas as pd
    features = pd.DataFrame([[
        data["N"],
        data["P"],
        data["K"],
        data["temperature"],
        data["soil_moisture"],
        data["ph"]
    ]], columns=["N", "P", "K", "temperature", "soil_moisture", "ph"])

    probs = model.predict_proba(features)[0]
    classes = model.classes_
    
    ml_results = []
    for c, p in zip(classes, probs):
        conf = round(float(p) * 100, 2)
        # Include ALL ML predictions to fill the list later
        ml_results.append({"crop": str(c), "confidence": conf, "type": "ML Model"})
            
    # 2. Check User Custom Crops (Rule-based)
    user_crops = load_crops()
    fav_results = []
    other_user_results = []
    
    current_N = float(data["N"])
    current_P = float(data["P"])
    current_K = float(data["K"])
    current_Temp = float(data["temperature"])
    current_Moist = float(data["soil_moisture"])
    current_pH = float(data["ph"])

    for crop in user_crops:
        score = 0
        total_checks = 6
        
        # Helper to check range (auto-swap min/max)
        def check(val, r_min, r_max):
            if r_min > r_max: r_min, r_max = r_max, r_min  # Swap if inverted
            
            if r_min <= val <= r_max: return 1
            margin = (r_max - r_min) * 0.2
            if margin == 0: margin = 0.5
            
            if (r_min - margin) <= val <= (r_max + margin): return 0.5
            return 0

        score += check(current_N, crop.get("N_min", 0), crop.get("N_max", 100))
        score += check(current_P, crop.get("P_min", 0), crop.get("P_max", 100))
        score += check(current_K, crop.get("K_min", 0), crop.get("K_max", 100))
        score += check(current_Temp, crop.get("temp_min", 0), crop.get("temp_max", 40))
        score += check(current_Moist, crop.get("moist_min", 0), crop.get("moist_max", 100))
        score += check(current_pH, crop.get("ph_min", 0), crop.get("ph_max", 14))
        
        final_percentage = round((score / total_checks) * 100, 2)
        
        is_fav = crop.get("favorite", False)
        
        # User Priority: Include ALL matching user crops (> 0%)
        if is_fav or final_percentage > 0:
            item = {
                "crop": crop["name"], 
                "confidence": final_percentage, 
                "type": "Favorite" if is_fav else "Your Crops"
            }
            if is_fav:
                fav_results.append(item)
            else:
                other_user_results.append(item)

    # 3. Sort Each Group by Confidence
    fav_results.sort(key=lambda x: x["confidence"], reverse=True)
    other_user_results.sort(key=lambda x: x["confidence"], reverse=True)
    ml_results.sort(key=lambda x: x["confidence"], reverse=True)

    # 4. Merge Priority: Favs -> Other User -> ML (Deduplicated)
    final_list = fav_results + other_user_results
    
    # Track existing names to avoid duplicates
    existing_names = {x["crop"].lower() for x in final_list}
    
    # Fill remaining slots with ML predictions
    for ml_item in ml_results:
        # Stop if we reached 25
        if len(final_list) >= 25:
            break
            
        if ml_item["crop"].lower() not in existing_names:
            final_list.append(ml_item)
            existing_names.add(ml_item["crop"].lower())
            
    # 5. AI FALLBACK: If still < 25, ask AI for more (with retry)
    if len(final_list) < 25:
        missing_count = 25 - len(final_list)
        print(f"List has {len(final_list)} items. Asking AI for {missing_count} more...")
        
        max_retries = 2
        for attempt in range(max_retries):
            try:
                ai_suggestions = get_ai_more_crops(data, list(existing_names), missing_count)
                # Ensure each suggestion has required keys
                for item in ai_suggestions:
                    if "confidence" not in item:
                        item["confidence"] = 50  # Default confidence for AI suggestions
                    if "type" not in item:
                        item["type"] = "AI Suggestion"
                    if "crop" not in item:
                        continue
                    if item["crop"].lower() not in existing_names:
                        final_list.append(item)
                        existing_names.add(item["crop"].lower())
                
                # Check if we have enough now
                if len(final_list) >= 25:
                    break
                else:
                    missing_count = 25 - len(final_list)
                    print(f"Retry {attempt+1}: Still need {missing_count} more crops...")
            except Exception as e:
                print(f"AI Fallback Failed (attempt {attempt+1}): {e}")
    
    # Take top 25 selected items (based on priority inclusion)
    selected_list = final_list[:25]
    
    # Returns 25 items. Now resort them STRICTLY by confidence for display
    # This satisfies "tile arrangement in descending order of confidence"
    selected_list.sort(key=lambda x: x.get("confidence", 0), reverse=True)
    
    top_list = selected_list



    return jsonify({
        "predicted_crop": top_list[0]["crop"] if top_list else "Unknown",
        "confidence": top_list[0]["confidence"] if top_list else 0,
        "recommendations": top_list
    })

# ================= DELETE CROP =================
@app.route("/api/crops/<crop_name>", methods=["DELETE"])
def delete_crop(crop_name):
    crops = load_crops()
    crops = [c for c in crops if c["name"] != crop_name]
    save_crops(crops)
    return jsonify({"message": "Crop removed"})


# ================= FRONTEND CATCH-ALL =================
@app.route("/<path:path>")
def serve_files(path):
    print(f"Serving file: {path}")  # Debug log
    return send_from_directory(FRONTEND_DIR, path)

# ================= RUN =================
if __name__ == "__main__":
    print("🚀 Starting Server with Alert Email:", ALERT_EMAILS)
    app.run(host="0.0.0.0", port=5000, debug=True)
