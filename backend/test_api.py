import asyncio
import httpx

async def main():
    base_url = "http://localhost:8000/api/v1"
    
    async with httpx.AsyncClient() as client:
        # 1. Login
        resp = await client.post(f"{base_url}/auth/login", data={"username": "26A2510410114", "password": "password"})
        if resp.status_code != 200:
            print("Login failed:", resp.text)
            return
        
        token = resp.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        # 2. Trigger task
        payload = {
            "experiment_id": "test_exp",
            "question_node_id": "SYMD_Fill_0",
            "current_form_values": {}
        }
        resp = await client.post(f"{base_url}/ai/generate-answer-direct", json=payload, headers=headers)
        print("Trigger response:", resp.text)
        
        if resp.status_code != 200:
            return
            
        task_id = resp.json().get("task_id")
        
        # 3. Poll
        for i in range(15):
            await asyncio.sleep(2)
            resp = await client.get(f"{base_url}/ai/task/{task_id}", headers=headers)
            print(f"Poll {i}: {resp.text}")
            if resp.json().get("status") != "pending":
                break

asyncio.run(main())
