import requests
import time

base_url = "http://localhost:8000/api/v1"

# 1. Login as admin
resp = requests.post(f"{base_url}/auth/token", data={
    "username": "admin",
    "password": "password"
})
token = resp.json()["access_token"]
headers = {"Authorization": f"Bearer {token}"}

# 2. Call generate-answer-direct
payload = {
    "experiment_id": "test_exp",
    "question_node_id": "SYMD_Fill_0",
    "current_form_values": {}
}
resp = requests.post(f"{base_url}/ai/generate-answer-direct", json=payload, headers=headers)
print("generate-answer-direct response:", resp.json())
task_id = resp.json().get("task_id")

if not task_id:
    print("Failed to get task_id")
    exit(1)

# 3. Poll task status
for i in range(10):
    resp = requests.get(f"{base_url}/ai/task/{task_id}", headers=headers)
    data = resp.json()
    print(f"Poll {i}: {data}")
    if data["status"] != "pending":
        break
    time.sleep(2)
