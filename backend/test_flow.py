import sys
import os

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlmodel import Session, select
from main import app
from core.db import get_session
from models.core import Experiment, User

client = TestClient(app)

def run_tests():
    print("\n[Test 1] 🚀 Connected to Live PostgreSQL Database...")
    # Inject test experiment to satisfy Foreign Key constraints
    with next(get_session()) as session:
        if not session.get(Experiment, "exp_001"):
            session.add(Experiment(id="exp_001", title="Test Exp"))
            session.commit()
    
    print("[Test 2] 🚀 Simulating Student Login...")
    res = client.post("/api/v1/auth/login", data={"username": "student_01", "password": "password"})
    assert res.status_code == 200
    student_token = res.json()["access_token"]
    
    print("[Test 3] 🚀 Simulating Admin Login...")
    res = client.post("/api/v1/auth/login", data={"username": "admin_boss", "password": "password"})
    assert res.status_code == 200
    admin_token = res.json()["access_token"]
    
    print("[Test 4] 🚀 Student creates a 'Pro' checkout order (which costs money)...")
    res = client.post(
        "/api/v1/checkout/submit",
        json={"plan": "pro", "is_hungup": True, "experiments": []},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200
    order_data = res.json()["order"]
    order_id = order_data["id"]
    assert order_data["status"] == "pending_payment"
    
    print("[Test 5] 🚀 Verifying plan checkout does not create a submission...")
    res = client.get("/api/v1/submissions/my", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200
    submissions = res.json()
    assert len(submissions) == 0
    
    print("[Test 6] 🚀 Student maliciously tries to view Review Pool (Should be Blocked!)...")
    res = client.get("/api/v1/submissions/review-pool", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 403 # Forbidden!
    print("      ✅ Success: Student was strictly blocked (403).")
    
    print("[Test 7] 🚀 Admin verifies the payment...")
    res = client.post(f"/api/v1/orders/{order_id}/verify", json={"action": "verify"}, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    
    print("[Test 8] 🚀 Verifying student's plan is now upgraded...")
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {student_token}"})
    assert res.json()["capabilities"]["plan"] == "pro"
    print("      ✅ Success: Plan dynamically upgraded!")

    print("\n🎉 ALL TESTS PASSED! The state machine and RBAC are watertight.")

if __name__ == "__main__":
    run_tests()
