# Smart Agriculture Dashboard

This project consists of a backend Flask API and a frontend interface to monitor smart agriculture sensor data, calculate crop compatibility using a machine-learning model, and provide AI-based recommendations.

## Setup Instructions

### 1. Prerequisites
- Python 3.8+ installed
- Arduino setup (for `SERIAL_PORT` data)

### 2. Environment Setup
Create a `.env` file in the `backend/` directory by referring and providing values based on your configuration:
```env
AI_API_KEY="sk-or-v1-xxxxxxxxxxxxxxxx"
RESEND_API_KEY="re_xxxxxxxxxxx"
ALERT_EMAILS="your_email@gmail.com"
FIREBASE_AUTH="your_firebase_auth_key"
SERIAL_PORT="COM3" # Adjust based on your system (e.g., /dev/ttyUSB0 for linux)
```

### 3. Backend Setup
1. Navigate to the backend directory:
   ```bash
   cd backend
   ```
2. Create and activate a python virtual environment (Optional but Recommended):
   ```bash
   python -m venv .venv
   # Windows
   .venv\Scripts\activate
   # Linux/Mac
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. If you do not have the `ml_model.pkl` generated, run the training script:
   ```bash
   python train_model.py
   ```

### 4. Running the Server
Start the Flask application (from the `backend` folder):
```bash
python app.py
```

The frontend will be served at `http://127.0.0.1:5000/`.
