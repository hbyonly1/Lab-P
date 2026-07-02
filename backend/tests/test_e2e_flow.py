import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlalchemy import delete, or_
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from main import app
from api.v1.automation_config import default_automation_config
from core.db import get_session
from models.core import Experiment, User, Order, Submission, AuditLog
from core.security import get_password_hash

client = TestClient(app)

STUDENT_NO = "26A2511111111"
FREE_STUDENT_NO = "26A2522222222"

@pytest.fixture(scope="session", autouse=True)
def setup_test_data():
    """Ensure test data exists in the DB"""
    with next(get_session()) as session:
        if not session.get(Experiment, "exp_e2e_flow_unique"):
            session.add(Experiment(id="exp_e2e_flow_unique", title="Test Exp E2E"))

        existing_test_users = session.exec(
            select(User).where(
                or_(
                    User.username.in_([STUDENT_NO, FREE_STUDENT_NO, "student_e2e_flow", "student_free_flow"]),
                    User.student_no.in_([STUDENT_NO, FREE_STUDENT_NO]),
                )
            )
        ).all()
        existing_test_user_ids = [user.id for user in existing_test_users]
        if existing_test_user_ids:
            session.exec(delete(AuditLog).where(AuditLog.user_id.in_(existing_test_user_ids)))
            session.exec(delete(Submission).where(Submission.student_id.in_(existing_test_user_ids)))
            session.exec(delete(Order).where(Order.student_id.in_(existing_test_user_ids)))
            session.exec(delete(User).where(User.id.in_(existing_test_user_ids)))
            session.flush()

        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        if not student:
            student = User(
                username=STUDENT_NO,
                student_no=STUDENT_NO,
                hashed_password=get_password_hash(STUDENT_NO),
                role="student",
            )
            session.add(student)
            session.flush()

        student_free = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
        if not student_free:
            student_free = User(
                username=FREE_STUDENT_NO,
                student_no=FREE_STUDENT_NO,
                hashed_password=get_password_hash(FREE_STUDENT_NO),
                role="student",
            )
            session.add(student_free)
            session.flush()
            
        admin = session.exec(select(User).where(User.username == "admin_e2e_flow")).first()
        if not admin:
            admin = User(username="admin_e2e_flow", hashed_password=get_password_hash("password"), role="admin")
            session.add(admin)
            
        session.commit()

@pytest.fixture
def student_token():
    res = client.post("/api/v1/auth/login", data={"username": STUDENT_NO, "password": STUDENT_NO})
    return res.json()["access_token"]

@pytest.fixture
def free_student_token():
    res = client.post("/api/v1/auth/login", data={"username": FREE_STUDENT_NO, "password": FREE_STUDENT_NO})
    return res.json()["access_token"]

@pytest.fixture
def admin_token():
    res = client.post("/api/v1/auth/login", data={"username": "admin_e2e_flow", "password": "password"})
    return res.json()["access_token"]

def test_student_payment_flow(student_token, admin_token):
    # 0. Mock uploading an image
    # We will simulate the frontend sending a mock image
    image_content = b"fake_image_bytes"
    res = client.post(
        "/api/v1/files/upload",
        files={"file": ("test_image.jpg", image_content, "image/jpeg")},
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 200, res.text
    upload_data = res.json()
    image_url = upload_data["url"]
    assert image_url.startswith("/uploads/")

    # 1. Student creates a submission with is_hungup=True and passes image_paths
    res = client.post(
        "/api/v1/submissions/submit",
        json={"experiment_id": "exp_e2e_flow_unique", "is_hungup": True, "image_paths": [image_url]},
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 200, res.text
    submission = res.json()
    assert submission["status"] in ["pending_payment", "pending_recognition"]
    
    order_id = submission["order_id"]
    
    # 2. Admin retrieves orders and sees the pending order
    res = client.get("/api/v1/orders/", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    orders = res.json()
    order_found = next((o for o in orders if o["id"] == order_id), None)
    assert order_found is not None
    assert order_found["status"] == "pending_payment"
    
    # 3. Admin verifies the order
    res = client.post(
        f"/api/v1/orders/{order_id}/verify",
        json={"action": "verify"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200
    
    # 4. Reviewer (Admin) retrieves review pool and sees the task pending recognition WITH images.
    res = client.get("/api/v1/submissions/review-pool", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    review_pool = res.json()
    sub_found = next((s for s in review_pool if s["id"] == submission["id"]), None)
    assert sub_found is not None
    assert sub_found["status"] in ["pending_recognition", "recognizing"]

    # 4.5 Check the specific submission endpoint returns image_paths
    res = client.get(f"/api/v1/submissions/{submission['id']}", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    sub_detail = res.json()
    assert image_url in sub_detail["image_paths"]

    # 5. Check AuditLog is automatically generated via SQLAlchemy listener
    with next(get_session()) as session:
        logs = session.exec(select(AuditLog).where(AuditLog.target_id == submission["id"])).all()
        assert len(logs) > 0, "No audit logs found! Event listener might not be working."
        # We expect at least the submission_created log, and then the status_changed log when admin verified
        actions = [log.action for log in logs]
        assert "submission_created" in actions
        assert "status_changed" in actions

def test_upgrade_plus_flow(free_student_token):
    # 1. Free student upgrades to Plus
    res = client.post(
        "/api/v1/orders/",
        json={"experiment_id": "UPGRADE_PLAN", "plan": "plus"},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200, res.text
    order = res.json()
    assert order["plan"] == "plus"
    assert order["status"] == "pending_payment"
    assert order["experiment_id"] is None # Upgrades set experiment_id to None
    
    # 2. Student decides to buy Pro Plan
    res = client.post(
        "/api/v1/orders/",
        json={"experiment_id": "exp_e2e_flow_unique", "plan": "pro"},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200

def test_admin_automation_config(admin_token, student_token):
    # Students must not see automation selectors or Playwright runtime config.
    res = client.get("/api/v1/admin/automation-config", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 403

    res = client.get("/api/v1/admin/automation-config", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    config = res.json()
    assert config["config_json"]["identity"]["passwordPolicy"] == "same_as_student_no"

    config_json = default_automation_config()
    config_json["schoolSystem"]["baseUrl"] = "https://school.example.edu"
    config_json["schoolSystem"]["loginUrl"] = "https://school.example.edu/login"
    payload = {
        "name": "default",
        "schema_version": "1.1",
        "is_active": True,
        "config_json": config_json,
    }
    res = client.patch(
        "/api/v1/admin/automation-config",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["config_json"]["schoolSystem"]["baseUrl"] == "https://school.example.edu"

def test_student_experiment_list_filters_disabled_configs(student_token, admin_token):
    visible_id = "exp_e2e_visible_config"
    hidden_id = "exp_e2e_hidden_config"

    with next(get_session()) as session:
        for exp_id in [visible_id, hidden_id]:
            existing = session.get(Experiment, exp_id)
            if existing:
                session.delete(existing)
        session.flush()
        session.add(Experiment(
            id=hidden_id,
            title="Hidden Config",
            version="1.0",
            config_json={
                "meta": {
                    "id": hidden_id,
                    "name": "Hidden Config",
                    "version": "1.0",
                    "sortOrder": 5,
                    "enabled": False,
                },
                "inputs": {},
            },
        ))
        session.add(Experiment(
            id=visible_id,
            title="Visible Config",
            version="1.0",
            config_json={
                "meta": {
                    "id": visible_id,
                    "name": "Visible Config",
                    "version": "1.0",
                    "sortOrder": 10,
                    "enabled": True,
                },
                "inputs": {},
            },
        ))
        session.commit()

    res = client.get("/api/v1/experiments", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    admin_ids = [item["id"] for item in res.json()]
    assert hidden_id in admin_ids
    assert visible_id in admin_ids

    res = client.get("/api/v1/experiments", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200, res.text
    student_ids = [item["id"] for item in res.json()]
    assert visible_id in student_ids
    assert hidden_id not in student_ids

    res = client.get(f"/api/v1/experiments/{hidden_id}", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 404

def test_student_audit_logs_hide_internal_actions(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.add(AuditLog(
            user_id=student.id,
            action="save_submission_correction",
            status="success",
            target_id="SUB-INTERNAL",
            details="内部草稿保存动作不应展示给学生。",
        ))
        session.add(AuditLog(
            user_id=student.id,
            action="order_created",
            status="success",
            target_id="ORD-VISIBLE",
            details="创建订单。",
        ))
        session.commit()

    res = client.get("/api/v1/audit/my_logs", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200, res.text
    actions = [item["action"] for item in res.json()]
    assert "order_created" in actions
    assert "save_submission_correction" not in actions

def test_free_to_pro_flow(free_student_token, admin_token):
    # 1. Free student tries to submit WITHOUT hungup, should be 403 Forbidden!
    res = client.post(
        "/api/v1/submissions/submit",
        json={"experiment_id": "exp_e2e_flow_unique", "is_hungup": False},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 403, "Student should be blocked from submitting without paying!"
    
    # 2. Student decides to buy Pro Plan
    res = client.post(
        "/api/v1/orders/",
        json={"experiment_id": "exp_e2e_flow_unique", "plan": "pro"},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200
    pro_order_id = res.json()["id"]
    
    # 3. Admin verifies the Pro Plan order, upgrading the student
    res = client.post(
        f"/api/v1/orders/{pro_order_id}/verify",
        json={"action": "verify"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200

    # 4. Student submits again, this time they are Pro, should bypass payment!
    res = client.post(
        "/api/v1/submissions/submit",
        json={"experiment_id": "exp_e2e_flow_unique", "is_hungup": False},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200, "Pro user should be allowed to submit without hungup!"
    submission = res.json()
    
    # 5. Verify it's immediately in the review pool
    res = client.get("/api/v1/submissions/review-pool", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    review_pool = res.json()
    sub_found = next((s for s in review_pool if s["id"] == submission["id"]), None)
    assert sub_found is not None
    assert sub_found["status"] == "pending_recognition"
