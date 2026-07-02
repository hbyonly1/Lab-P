"""
test_feedback.py: 测试 Feedback API

运行方式（在容器中）:
  pip install pytest requests
  python -m pytest test_feedback.py -v
"""
import pytest
import requests
import random
import string

BASE = "http://localhost:8000/api/v1"


# ──────────────────────────────
# Helpers
# ──────────────────────────────

def login(username: str, password: str) -> str:
    resp = requests.post(f"{BASE}/auth/login", data={"username": username, "password": password})
    assert resp.status_code == 200, f"Login failed for '{username}': {resp.text}"
    return resp.json()["access_token"]


def make_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def create_student_in_db(username: str, password: str):
    """Directly insert a student via SQLModel (runs inside container)."""
    from core.db import engine
    from models.core import User
    from core.security import get_password_hash
    from sqlmodel import Session, select

    with Session(engine) as session:
        existing = session.exec(select(User).where(User.username == username)).first()
        if not existing:
            user = User(
                username=username,
                hashed_password=get_password_hash(password),
                role="student",
                capabilities={},
            )
            session.add(user)
            session.commit()


# ──────────────────────────────
# Fixtures
# ──────────────────────────────

@pytest.fixture(scope="module")
def admin_token():
    import os
    username = os.environ.get("ADMIN_USERNAME", "admin")
    password = os.environ.get("ADMIN_PASSWORD", "admin")
    return login(username, password)


@pytest.fixture(scope="module")
def student_token():
    uname = "testfb_" + "".join(random.choices(string.ascii_lowercase, k=6))
    pwd = "test1234"
    create_student_in_db(uname, pwd)
    return login(uname, pwd)


# ──────────────────────────────
# Tests
# ──────────────────────────────

class TestFeedbackSubmit:
    def test_submit_feedback_success(self, student_token):
        resp = requests.post(
            f"{BASE}/feedback/",
            json={"description": "集成测试反馈内容。", "contact_info": "test@example.com"},
            headers=make_headers(student_token),
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert "id" in data
        assert "反馈提交成功" in data["message"]

    def test_submit_feedback_no_contact(self, student_token):
        """联系方式可选"""
        resp = requests.post(
            f"{BASE}/feedback/",
            json={"description": "没有联系方式的反馈"},
            headers=make_headers(student_token),
        )
        assert resp.status_code == 201, resp.text

    def test_submit_feedback_empty_description(self, student_token):
        """空描述应被拒绝"""
        resp = requests.post(
            f"{BASE}/feedback/",
            json={"description": "  "},
            headers=make_headers(student_token),
        )
        assert resp.status_code == 400, resp.text

    def test_submit_unauthenticated(self):
        """未认证请求应被拒绝（401）"""
        resp = requests.post(f"{BASE}/feedback/", json={"description": "无 token"})
        assert resp.status_code == 401, resp.text


class TestFeedbackAdminRead:
    def test_admin_can_list(self, admin_token):
        resp = requests.get(f"{BASE}/feedback/", headers=make_headers(admin_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert isinstance(data, list)

    def test_admin_can_get_stats(self, admin_token):
        resp = requests.get(f"{BASE}/feedback/stats", headers=make_headers(admin_token))
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert "total" in data
        assert isinstance(data["total"], int)

    def test_student_cannot_list(self, student_token):
        """学生不能读取反馈列表"""
        resp = requests.get(f"{BASE}/feedback/", headers=make_headers(student_token))
        assert resp.status_code == 403, resp.text

    def test_student_cannot_get_stats(self, student_token):
        """学生不能读取统计数据"""
        resp = requests.get(f"{BASE}/feedback/stats", headers=make_headers(student_token))
        assert resp.status_code == 403, resp.text
