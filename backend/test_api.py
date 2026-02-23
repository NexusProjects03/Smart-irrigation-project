import requests
import json

API_KEY = "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"
MODEL = "google/gemma-3n-e2b-it:free"
URL = "https://openrouter.ai/api/v1/chat/completions"

print("Testing OpenRouter API...")
print(f"Model: {MODEL}")
print(f"URL: {URL}")
print()

try:
    response = requests.post(
        URL,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5000",
            "X-Title": "Smart Agriculture Test"
        },
        json={
            "model": MODEL,
            "messages": [
                {"role": "user", "content": "Say 'Hello, API is working!' in JSON format: {\"message\": \"...\"}"}
            ]
        },
        timeout=30
    )
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    print()
    
    if response.status_code == 200:
        print("SUCCESS! Response:")
        print(json.dumps(response.json(), indent=2))
    else:
        print("ERROR Response:")
        print(response.text)
        
except Exception as e:
    print(f"EXCEPTION: {type(e).__name__}")
    print(f"Message: {str(e)}")
    import traceback
    traceback.print_exc()
