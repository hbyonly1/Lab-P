import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlalchemy import delete, or_
import sys
import os
import json
import asyncio

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from main import app
from api.v1 import school_sync
from api.v1.automation_config import CONFIG_SCHEMA_VERSION, default_automation_config
from core.config import settings
from core.db import get_session
from models.core import Experiment, User, Order, Submission, SubmissionVersion, AuditLog, AutomationJob, SchoolSyncSnapshot, get_utc_now
from core.security import get_password_hash
from services.automation_job_service import (
    AutomationJobConflict,
    create_or_reuse_automation_job,
    make_idempotency_key,
)
from services.school_overview_sync import SchoolAutomationError, extract_captcha_candidate, extract_report_list, mark_overview_failed
import services.school_report_sync as school_report_sync_service
from services.school_report_sync import SchoolReportOpenResult
from services.school_dom import wait_for_locator_value
from services.school_session_manager import SchoolSessionManager, school_session_manager

client = TestClient(app)

STUDENT_NO = "26A2511111111"
FREE_STUDENT_NO = "26A2522222222"


class FakeLocator:
    def __init__(self, count_value, page=None, selector=""):
        self.count_value = count_value
        self.page = page
        self.selector = selector

    @property
    def first(self):
        return self

    async def count(self):
        return self.count_value

    async def is_visible(self):
        return self.count_value > 0

    async def click(self):
        if self.page and hasattr(self.page, "handle_click"):
            self.page.handle_click(self.selector)

    async def wait_for(self, state="visible", timeout=30000):
        if state == "visible" and self.count_value <= 0:
            raise TimeoutError("locator not visible")


class FakeSchoolPage:
    def __init__(self, *, closed=False, url="http://10.25.77.60:8001/ReportStudent/CompleteReport/"):
        self._closed = closed
        self.url = url

    def is_closed(self):
        return self._closed

    def locator(self, selector):
        counts = {
            "#LoginUserName": 1,
            "tbody[data-bind='foreach: CompleteReportList'] tr": 2,
            "#ReportModal": 0,
        }
        return FakeLocator(counts.get(selector, 0), page=self, selector=selector)

    async def wait_for_timeout(self, _ms):
        return None


class FakeModalSchoolPage(FakeSchoolPage):
    def __init__(self):
        super().__init__()
        self.modal_open = True

    def handle_click(self, selector):
        if selector in ["#ReportModal button:has-text('关闭')", "#ReportModal .close"]:
            self.modal_open = False

    def locator(self, selector):
        counts = {
            "#LoginUserName": 1,
            "tbody[data-bind='foreach: CompleteReportList'] tr": 0 if self.modal_open else 2,
            "#ReportModal": 1 if self.modal_open else 0,
            "#ReportModal button:has-text('关闭')": 1 if self.modal_open else 0,
        }
        return FakeLocator(counts.get(selector, 0), page=self, selector=selector)


class FakeReportListColumnsPage(FakeSchoolPage):
    async def wait_for_function(self, *_args, **_kwargs):
        return True

    async def evaluate(self, _script, _args=None):
        cells = [
            "液晶电光效应实验0625",
            "大学物理实验I",
            "液晶电光效应实验",
            "第14周-星期五 2026/6/5",
            "第22周-星期一 2026/7/27",
            "",
            "未提交",
            "未评阅",
        ]
        experiment_idx = int((_args or {}).get("experimentIdx", 0))
        status_idx = int((_args or {}).get("statusIdx", 6))
        return [
            {
                "experimentName": cells[experiment_idx],
                "originalStatusText": cells[status_idx],
            }
        ]


class FakeValueLocator:
    def __init__(self, values):
        self.values = list(values)
        self.last_value = self.values[-1] if self.values else ""

    async def evaluate(self, _script):
        if self.values:
            self.last_value = self.values.pop(0)
        return self.last_value


class FakeDiagnosticLocator:
    def __init__(self, diagnostic=None, count_value=1):
        self.diagnostic = diagnostic or {}
        self.count_value = count_value

    @property
    def first(self):
        return self

    async def count(self):
        return self.count_value

    async def is_visible(self):
        return bool(self.diagnostic.get("isVisible", False))

    async def evaluate(self, script, *_args):
        if "tagName.toLowerCase" in script and "getComputedStyle" not in script:
            return self.diagnostic.get("tag", "textarea")
        if "isContentEditable" in script and "getComputedStyle" not in script:
            return self.diagnostic.get("isContentEditable", False)
        return self.diagnostic


class FakeMappingAuditPage:
    def __init__(self, diagnostics):
        self.diagnostics = diagnostics

    def locator(self, selector):
        clean_selector = selector.split(" ", 1)[-1] if selector.startswith("#ReportModal ") else selector
        diagnostic = self.diagnostics.get(clean_selector)
        return FakeDiagnosticLocator(diagnostic, 1 if diagnostic else 0)


class FakeSubmitFeedbackPage:
    def __init__(self, feedback_messages, *, wait_raises=False):
        self.feedback_messages = feedback_messages
        self.wait_raises = wait_raises
        self.wait_scripts = []
        self.evaluate_scripts = []

    def locator(self, selector):
        return FakeLocator(1, page=self, selector=selector)

    def on(self, *_args, **_kwargs):
        return None

    async def wait_for_function(self, script, arg=None, **_kwargs):
        self.wait_scripts.append((script, arg))
        assert ".modal-body" not in str(arg or "")
        assert "#ReportModal" not in str(arg or "")
        if self.wait_raises:
            raise TimeoutError("feedback timeout")
        return True

    async def evaluate(self, script, arg=None):
        self.evaluate_scripts.append(script)
        assert ".modal-body" not in script
        if "submitStage" in script and "bootboxCandidates" in script:
            return {
                "submitStage": (arg or {}).get("stage"),
                "feedbackTimeoutMs": (arg or {}).get("timeoutMs"),
                "visibleBootboxCount": 0,
                "bootboxCandidates": [],
                "visibleModalSummaries": [
                    {"selectorHint": "#kvFileinputModal", "textPreview": "上传图片： × 0% 移除 取消 选择"}
                ],
                "hasFileUploadDialog": True,
            }
        assert ".bootbox .bootbox-body" in script
        return self.feedback_messages


def test_wait_for_locator_value_retries_until_value_matches():
    locator = FakeValueLocator(["", "old", "expected"])
    actual = asyncio.run(wait_for_locator_value(locator, "expected", timeout_ms=1000, interval_ms=1))
    assert actual == "expected"


def test_mapping_audit_recommends_wysiwyg_for_hidden_textarea():
    page = FakeMappingAuditPage(
        {
            "#skt0Area": {
                "tag": "textarea",
                "className": "editorClass hide",
                "isVisible": False,
                "hasWysiwygWrapper": True,
                "hasWysiwygEditor": True,
                "hasImageToolbarButton": False,
            }
        }
    )
    audit = asyncio.run(
        school_report_sync_service._build_mapping_audit(
            page,
            "#ReportModal",
            "exp_meter_modification",
            {"skt0Area": "你好"},
        )
    )
    item = next(row for row in audit if row["sourceId"] == "skt0Area")
    assert item["mappingExists"] is True
    assert item["targetLocator"] == "#skt0Area"
    assert item["targetType"] == "wysiwyg_text"


def test_mapping_audit_reports_meter_image_mapping():
    page = FakeMappingAuditPage({})
    audit = asyncio.run(
        school_report_sync_service._build_mapping_audit(
            page,
            "#ReportModal",
            "exp_meter_modification",
            {"YSSJDrawingAreaArea": "/uploads/test.png"},
        )
    )
    item = next(row for row in audit if row["sourceId"] == "YSSJDrawingAreaArea")
    assert item["platformHasValue"] is True
    assert item["mappingExists"] is True
    assert item["targetLocator"] == "#YSSJDrawingAreaArea"
    assert item["targetType"] == "wysiwyg_image"


def test_local_upload_path_resolution_prefers_existing_upload(tmp_path, monkeypatch):
    upload_dir = tmp_path / "uploads" / "2026-07"
    upload_dir.mkdir(parents=True)
    image_path = upload_dir / "field.png"
    image_path.write_bytes(b"fake")
    monkeypatch.chdir(tmp_path)

    resolved = school_report_sync_service._resolve_upload_file_path("/uploads/2026-07/field.png")

    assert resolved == image_path


def test_submit_feedback_only_reads_bootbox_alert_body():
    page = FakeSubmitFeedbackPage(["提交成功!"])

    result = asyncio.run(
        school_report_sync_service._click_submit_and_wait_feedback(
            page,
            default_automation_config(),
            "draft",
        )
    )

    assert result["submitAccepted"] is True
    assert result["feedback"] == ["提交成功!"]


def test_submit_feedback_timeout_includes_modal_diagnostic():
    page = FakeSubmitFeedbackPage([], wait_raises=True)

    try:
        asyncio.run(
            school_report_sync_service._click_submit_and_wait_feedback(
                page,
                default_automation_config(),
                "draft",
            )
        )
    except SchoolAutomationError as exc:
        assert exc.error_code == "SUBMIT_FEEDBACK_TIMEOUT"
        detail = json.loads(exc.message)
        assert detail["feedback"] == []
        assert detail["timeoutDiagnostic"]["hasFileUploadDialog"] is True
        assert detail["timeoutDiagnostic"]["visibleModalSummaries"][0]["selectorHint"] == "#kvFileinputModal"
    else:
        raise AssertionError("expected SUBMIT_FEEDBACK_TIMEOUT")


def test_extract_report_list_uses_paper_name_column_by_default():
    items = asyncio.run(extract_report_list(FakeReportListColumnsPage(), default_automation_config(), timeout_ms=1000))
    assert items[0]["experimentName"] == "液晶电光效应实验0625"
    assert items[0]["schoolStatus"] == "school_not_submitted"


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
            session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id.in_(existing_test_user_ids)))
            session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id.in_(existing_test_user_ids)))
            existing_submission_ids = [
                item.id for item in session.exec(select(Submission).where(Submission.student_id.in_(existing_test_user_ids))).all()
            ]
            if existing_submission_ids:
                session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(existing_submission_ids)))
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


def test_student_auth_response_includes_synced_identity():
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        student.real_name = "同步姓名"
        session.add(student)
        session.commit()

    res = client.post("/api/v1/auth/login", data={"username": STUDENT_NO, "password": STUDENT_NO})
    assert res.status_code == 200, res.text
    login_data = res.json()
    assert login_data["username"] == STUDENT_NO
    assert login_data["student_no"] == STUDENT_NO
    assert login_data["real_name"] == "同步姓名"

    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {login_data['access_token']}"})
    assert res.status_code == 200, res.text
    me_data = res.json()
    assert me_data["student_no"] == STUDENT_NO
    assert me_data["real_name"] == "同步姓名"


def test_review_pool_does_not_mock_missing_real_name(admin_token):
    submission_id = "SUB-NO-REAL-NAME"
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
        student.real_name = None
        existing = session.get(Submission, submission_id)
        if existing:
            session.delete(existing)
            session.flush()
        session.add(student)
        session.add(
            Submission(
                id=submission_id,
                student_id=student.id,
                experiment_id="exp_e2e_flow_unique",
                status="reviewing",
                payment_status="paid",
            )
        )
        session.commit()

    res = client.get("/api/v1/submissions/review-pool", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    item = next((sub for sub in res.json() if sub["id"] == submission_id), None)
    assert item is not None
    assert item["student_no"] == FREE_STUDENT_NO
    assert item["real_name"] is None
    assert item["student_name"] is None

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
    assert config_json["captcha"]["expectedLength"] == 4
    assert config_json["runtime"]["keepBrowserOpenAfterLogin"] is True
    assert config_json["networkPolicy"]["phase"] == "direct_intranet_only"
    assert config_json["waitPolicy"]["listRefreshTimeoutMs"] == 30000
    config_json["runtime"]["slowMoMs"] = 123
    payload = {
        "name": "default",
        "schema_version": CONFIG_SCHEMA_VERSION,
        "is_active": True,
        "config_json": config_json,
    }
    try:
        res = client.patch(
            "/api/v1/admin/automation-config",
            json=payload,
            headers={"Authorization": f"Bearer {admin_token}"},
        )
        assert res.status_code == 200, res.text
        saved_config = res.json()["config_json"]
        assert saved_config["runtime"]["slowMoMs"] == 123
        assert saved_config["schoolSystem"]["baseUrl"] == "http://10.25.77.60:8001"
        assert saved_config["schoolSystem"]["loginUrl"] == "http://10.25.77.60:8001/Login"
    finally:
        client.patch(
            "/api/v1/admin/automation-config",
            json={
                "name": "default",
                "schema_version": CONFIG_SCHEMA_VERSION,
                "is_active": True,
                "config_json": default_automation_config(),
            },
            headers={"Authorization": f"Bearer {admin_token}"},
        )


def test_captcha_candidate_requires_exact_expected_length():
    assert extract_captcha_candidate("GAA4", 4) == "GAA4"
    assert extract_captcha_candidate("验证码为：GAA4", 4) == "GAA4"
    assert extract_captcha_candidate("GAA", 4) is None
    assert extract_captcha_candidate("GAA45", 4) is None


def test_school_session_manager_registers_and_diagnoses_user_session():
    manager = SchoolSessionManager()
    page = FakeSchoolPage()
    manager.register(
        user_id=66,
        job_id="JOB-SESSION-1",
        playwright=object(),
        browser=object(),
        context=object(),
        page=page,
        source="overview_login",
    )

    session = manager.get(66)
    assert session is not None
    assert session.page is page

    diagnostic = asyncio.run(manager.diagnose(66, default_automation_config()))
    assert diagnostic["hasSession"] is True
    assert diagnostic["pageClosed"] is False
    assert diagnostic["onLoginPage"] is False
    assert diagnostic["hasRealNameNode"] is True
    assert diagnostic["hasReportRows"] is True


def test_school_session_manager_runs_coroutines_on_persistent_loop():
    manager = SchoolSessionManager()

    async def loop_id():
        return id(asyncio.get_running_loop())

    first_loop_id = manager.run(loop_id())
    second_loop_id = manager.run(loop_id())

    assert first_loop_id == second_loop_id
    manager.shutdown(reason="test_complete")


def test_school_session_manager_recovers_modal_to_report_list():
    manager = SchoolSessionManager()
    page = FakeModalSchoolPage()
    manager.register(
        user_id=67,
        job_id="JOB-MODAL-RECOVER",
        playwright=object(),
        browser=object(),
        context=object(),
        page=page,
        source="detail_sync",
    )

    recovered_page, diagnostic = asyncio.run(manager.ensure_report_list(67, default_automation_config()))

    assert recovered_page is page
    assert page.modal_open is False
    assert diagnostic["state"] == "report_list"
    assert diagnostic["reuseDecision"] in ["recovered_existing_session", "reused_existing_session"]


def test_admin_ai_config_uses_database_profiles_without_key_leak(admin_token, student_token):
    res = client.get("/api/v1/ai/admin/config", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 403

    payload = {
        "provider": "openai_compatible",
        "base_url": "https://api.siliconflow.cn/v1",
        "default_model": "deepseek-ai/DeepSeek-V4-Flash",
        "default_timeout_seconds": 60,
        "default_temperature": 0.7,
        "default_max_images_per_task": 8,
        "auto_recognize": False,
        "image_recognition_model": "deepseek-ai/DeepSeek-OCR",
        "image_recognition_timeout_seconds": 60,
        "image_recognition_temperature": 0,
        "image_recognition_max_images_per_task": 8,
        "answer_generation_model": "deepseek-ai/DeepSeek-V4-Flash",
        "answer_generation_timeout_seconds": 60,
        "answer_generation_temperature": 0.85,
        "captcha_model": "zai-org/GLM-4.5V",
        "captcha_timeout_seconds": 30,
        "captcha_temperature": 0,
        "captcha_prompt": "OCR this captcha. Return exactly one token: the 4-character uppercase code.",
    }
    res = client.put(
        "/api/v1/ai/admin/config",
        json=payload,
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 403

    res = client.post(
        "/api/v1/ai/admin/test-connection",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 403

    res = client.put(
        "/api/v1/ai/admin/config",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["source"] == "database"
    assert data["base_url"] == payload["base_url"]
    assert data["image_recognition_model"] == "deepseek-ai/DeepSeek-OCR"
    assert data["answer_generation_model"] == "deepseek-ai/DeepSeek-V4-Flash"
    assert data["captcha_model"] == "zai-org/GLM-4.5V"
    assert "api_key" not in data


def test_admin_ai_connection_reports_missing_api_key(admin_token, monkeypatch):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.setattr(settings, "AI_API_KEY", None)

    res = client.post(
        "/api/v1/ai/admin/test-connection",
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert res.status_code == 200, res.text
    data = res.json()
    assert data["ok"] is False
    assert data["error_code"] == "missing_api_key"
    assert "AI_API_KEY" in data["error"]


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


def test_automation_job_public_response_is_sanitized(student_token, admin_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        job = AutomationJob(
            id="JOB-PUBLIC-SAFE",
            actor_user_id=student.id,
            action="school_overview_sync",
            status="running",
            public_status="running",
            public_message_code="school.overview.syncing",
            public_message_params={"experimentName": "电表的改装", "selector": "#secret"},
            request_payload={"password": "should-not-leak", "selector": "#userPass"},
            result_payload={"html": "<html>secret</html>"},
            sensitive_payload={"captcha": "1234", "apiKey": "secret"},
        )
        existing = session.get(AutomationJob, job.id)
        if existing:
            session.delete(existing)
            session.flush()
        session.add(job)
        session.commit()

    res = client.get(
        "/api/v1/automation-jobs/JOB-PUBLIC-SAFE",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["jobId"] == "JOB-PUBLIC-SAFE"
    assert data["messageCode"] == "school.overview.syncing"
    assert data["messageParams"] == {"experimentName": "电表的改装"}
    assert "request_payload" not in data
    assert "requestPayload" not in data
    assert "result_payload" not in data
    assert "resultPayload" not in data
    assert "sensitive_payload" not in data
    assert "sensitivePayload" not in data

    res = client.get(
        "/api/v1/automation-jobs/active",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    assert any(item["jobId"] == "JOB-PUBLIC-SAFE" for item in res.json())

    res = client.get(
        "/api/v1/automation-jobs/JOB-PUBLIC-SAFE",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    assert "sensitivePayload" not in res.json()


def test_automation_job_creation_is_idempotent(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        session.commit()

        key = make_idempotency_key(
            "school_detail_sync",
            student.id,
            experiment_id="exp_meter_modification",
        )
        job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_detail_sync",
            idempotency_key=key,
            public_message_code="school.detail.syncing",
            public_message_params={"experimentName": "电表的改装"},
            experiment_id="exp_meter_modification",
            request_payload={"experiment_id": "exp_meter_modification"},
        )
        assert created is True
        session.commit()

        reused_job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_detail_sync",
            idempotency_key=key,
            public_message_code="school.detail.syncing",
            public_message_params={"experimentName": "电表的改装"},
            experiment_id="exp_meter_modification",
            request_payload={"experiment_id": "exp_meter_modification"},
        )
        assert created is False
        assert reused_job.id == job.id

        try:
            create_or_reuse_automation_job(
                session,
                actor_user_id=student.id,
                action="school_detail_sync",
                idempotency_key=key,
                public_message_code="school.detail.syncing",
                experiment_id="exp_meter_modification",
                request_payload={"experiment_id": "other"},
            )
        except AutomationJobConflict as exc:
            assert exc.code == "IDEMPOTENCY_CONFLICT"
        else:
            raise AssertionError("Expected IDEMPOTENCY_CONFLICT")

        other_key = make_idempotency_key(
            "school_detail_sync",
            student.id,
            experiment_id="exp_oscilloscope",
        )
        try:
            create_or_reuse_automation_job(
                session,
                actor_user_id=student.id,
                action="school_detail_sync",
                idempotency_key=other_key,
                public_message_code="school.detail.syncing",
                experiment_id="exp_oscilloscope",
                request_payload={"experiment_id": "exp_oscilloscope"},
            )
        except AutomationJobConflict as exc:
            assert exc.code == "JOB_ALREADY_RUNNING"
        else:
            raise AssertionError("Expected JOB_ALREADY_RUNNING")


def test_active_automation_job_can_only_be_cancelled_by_admin(student_token, admin_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        student_id = student.id
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        job = AutomationJob(
            id="JOB-CANCEL-ME",
            actor_user_id=student.id,
            action="school_detail_sync",
            status="running",
            public_status="running",
            public_message_code="school.detail.opening",
            experiment_id="exp_meter_modification",
        )
        session.add(job)
        session.commit()

    res = client.post(
        "/api/v1/automation-jobs/JOB-CANCEL-ME/cancel",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 403, res.text

    res = client.post(
        "/api/v1/automation-jobs/JOB-CANCEL-ME/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "failed"
    assert data["messageCode"] == "school.detail.failed"
    assert data["messageParams"]["reason"] == "任务已手动终止"

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-CANCEL-ME")
        assert job.status == "failed"
        assert job.error_code == "JOB_CANCELLED"
        assert job.result_payload["cancelledBy"] is not None
        assert job.result_payload["originalActorUserId"] == student_id


def test_polling_marks_school_job_failed_when_browser_closed(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        job = AutomationJob(
            id="JOB-BROWSER-CLOSED",
            actor_user_id=student.id,
            action="school_detail_sync",
            status="running",
            public_status="running",
            public_message_code="school.detail.opening",
            experiment_id="exp_meter_modification",
        )
        session.add(job)
        session.commit()
        student_id = student.id

    school_session_manager.register(
        user_id=student_id,
        job_id="JOB-BROWSER-CLOSED",
        playwright=object(),
        browser=object(),
        context=object(),
        page=FakeSchoolPage(closed=True),
        source="overview_login",
    )

    res = client.get(
        "/api/v1/automation-jobs/JOB-BROWSER-CLOSED",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "failed"
    assert data["messageCode"] == "school.detail.failed"
    assert data["messageParams"]["reason"] == "学校系统浏览器窗口已关闭"

    school_session_manager.mark_invalid(student_id, reason="test_cleanup")


def fake_successful_overview_sync(job_id, user_id):
    with next(get_session()) as session:
        job = session.get(AutomationJob, job_id)
        user = session.get(User, user_id)
        now = get_utc_now()
        summary = {
            "source": "school_complete_report_list",
            "realName": "测试学生",
            "total": 2,
            "completed": 1,
            "unsubmitted": 1,
            "draftSubmitted": 0,
            "finalSubmitted": 1,
            "unknown": 0,
        }
        user.real_name = "测试学生"
        session.add(user)
        session.add(
            SchoolSyncSnapshot(
                user_id=user_id,
                snapshot_json={
                    "source": "school_complete_report_list",
                    "realName": "测试学生",
                    "experiments": [
                        {
                            "experimentName": "实验 A",
                            "originalStatusText": "未提交",
                            "schoolStatus": "school_not_submitted",
                        },
                        {
                            "experimentName": "实验 B",
                            "originalStatusText": "正常提交",
                            "schoolStatus": "school_final_submitted",
                        },
                    ],
                },
                summary_json=summary,
                synced_at=now,
                automation_job_id=job_id,
            )
        )
        job.status = "succeeded"
        job.public_status = "succeeded"
        job.public_message_code = "school.overview.success"
        job.result_payload = {"summary": summary}
        job.finished_at = now
        job.updated_at = now
        session.add(job)
        session.add(
            AuditLog(
                user_id=user_id,
                action="school_overview_sync_completed",
                status="success",
                target_id=job_id,
                details="学校概览同步已完成。",
            )
        )
        session.commit()


def test_school_overview_sync_creates_public_job(student_token, monkeypatch):
    monkeypatch.setattr(school_sync, "run_school_overview_sync", fake_successful_overview_sync)

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        session.commit()

    res = client.get(
        "/api/v1/school-sync/overview/latest",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["shouldSync"] is True

    res = client.post(
        "/api/v1/school-sync/overview",
        json={"force": False},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["action"] == "school_overview_sync"
    assert "requestPayload" not in data
    assert "sensitivePayload" not in data

    res = client.get(
        f"/api/v1/automation-jobs/{data['jobId']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    final_job = res.json()
    assert final_job["status"] == "succeeded"
    assert final_job["messageCode"] == "school.overview.success"

    res = client.get(
        "/api/v1/school-sync/overview/latest",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    latest = res.json()
    assert latest["shouldSync"] is False
    assert latest["lastSyncedAt"] is not None
    assert latest["summary"]["source"] == "school_complete_report_list"
    assert latest["summary"]["total"] == 2
    assert latest["experiments"][0]["experimentName"] == "实验 A"
    assert latest["experiments"][0]["schoolStatus"] == "school_not_submitted"

    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200, res.text
    assert res.json()["real_name"] == "测试学生"

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        actions = [
            log.action
            for log in session.exec(select(AuditLog).where(AuditLog.user_id == student.id)).all()
        ]
        assert "school_overview_sync_started" in actions
        assert "school_overview_sync_completed" in actions


def test_school_overview_sync_blocks_parallel_jobs(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        active_job, created = create_or_reuse_automation_job(
            session,
            actor_user_id=student.id,
            action="school_detail_sync",
            idempotency_key=make_idempotency_key(
                "school_detail_sync",
                student.id,
                experiment_id="exp_meter_modification",
            ),
            public_message_code="school.detail.syncing",
            public_message_params={"experimentName": "电表的改装"},
            experiment_id="exp_meter_modification",
            request_payload={"experiment_id": "exp_meter_modification"},
        )
        assert created is True
        active_job.status = "running"
        active_job.public_status = "running"
        session.add(active_job)
        active_job_id = active_job.id
        session.commit()

    res = client.post(
        "/api/v1/school-sync/overview",
        json={"force": False},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 409, res.text
    detail = res.json()["detail"]
    assert detail["code"] == "JOB_ALREADY_RUNNING"
    assert detail["job"]["jobId"] == active_job_id
    assert "sensitivePayload" not in detail["job"]


def test_school_overview_failure_audit_contains_diagnostic_payload(student_token):
    config_json = default_automation_config()
    config_json["schoolSystem"]["baseUrl"] = "http://10.25.77.60:8001"
    config_json["schoolSystem"]["loginUrl"] = "http://10.25.77.60:8001/Login"
    config_json["networkPolicy"] = {"phase": "direct_intranet_only", "probeTimeoutMs": 3000}

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        job = AutomationJob(
            id="JOB-OVERVIEW-FAIL-DIAG",
            actor_user_id=student.id,
            action="school_overview_sync",
            status="running",
            public_status="running",
            public_message_code="school.overview.connecting",
            request_payload={"source": "student_overview", "force": True},
        )
        session.add(job)
        session.flush()
        mark_overview_failed(
            session,
            job=job,
            user_id=student.id,
            error=SchoolAutomationError(
                "NETWORK_UNREACHABLE",
                "服务器网络不可达",
                message="TimeoutError: timed out",
                current_step="school.overview.connecting",
            ),
            config=config_json,
        )
        session.commit()

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-OVERVIEW-FAIL-DIAG")
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "JOB-OVERVIEW-FAIL-DIAG")
            .where(AuditLog.action == "school_overview_sync_failed")
        ).first()
        details = json.loads(log.details)
        assert details["errorCode"] == "NETWORK_UNREACHABLE"
        assert details["message"] == "TimeoutError: timed out"
        assert details["config"]["schoolSystem"]["loginUrl"] == "http://10.25.77.60:8001/Login"
        assert details["config"]["networkPolicy"]["phase"] == "direct_intranet_only"
        assert details["config"]["waitPolicy"]["listRefreshTimeoutMs"] == 30000
        assert job.result_payload["diagnosticPayload"]["errorCode"] == "NETWORK_UNREACHABLE"


def test_school_detail_sync_does_not_create_stub_snapshot(student_token, monkeypatch):
    def fake_detail_failure(job_id, user_id, experiment_id):
        with next(get_session()) as session:
            job = session.get(AutomationJob, job_id)
            job.status = "failed"
            job.public_status = "failed"
            job.public_message_code = "school.detail.failed"
            job.public_message_params = {"reason": "学校系统会话不可用"}
            job.error_code = "SCHOOL_SESSION_UNAVAILABLE"
            job.error_message = "学校系统会话不可用"
            job.finished_at = get_utc_now()
            job.updated_at = get_utc_now()
            session.add(job)
            session.commit()

    monkeypatch.setattr(school_sync, "run_school_detail_sync", fake_detail_failure)

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        session.commit()

    res = client.post(
        "/api/v1/school-sync/experiments/exp_e2e_flow_unique",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["action"] == "school_detail_sync"
    assert data["experimentId"] == "exp_e2e_flow_unique"
    assert "requestPayload" not in data
    assert "sensitivePayload" not in data

    res = client.get(
        f"/api/v1/automation-jobs/{data['jobId']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    final_job = res.json()
    assert final_job["status"] == "failed"
    assert final_job["messageCode"] == "school.detail.failed"

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        snapshot = session.exec(
            select(SchoolSyncSnapshot)
            .where(SchoolSyncSnapshot.user_id == student.id)
            .where(SchoolSyncSnapshot.experiment_id == "exp_e2e_flow_unique")
        ).first()
        assert snapshot is None


def test_school_detail_latest_returns_mapped_form_values(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.add(
            SchoolSyncSnapshot(
                user_id=student.id,
                experiment_id="exp_e2e_flow_unique",
                snapshot_json={
                    "source": "school_report_modal",
                    "experimentId": "exp_e2e_flow_unique",
                    "experimentName": "Test Exp E2E",
                    "values": {"DBGZ10-0": "raw school value"},
                    "formValues": {"A": "1.23", "B": ""},
                },
                summary_json={"source": "school_report_modal", "fieldCount": 2},
                synced_at=get_utc_now(),
            )
        )
        session.commit()

    res = client.get(
        "/api/v1/school-sync/experiments/exp_e2e_flow_unique/latest",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["experimentId"] == "exp_e2e_flow_unique"
    assert data["experimentName"] == "Test Exp E2E"
    assert data["formValues"] == {"A": "1.23", "B": ""}
    assert data["summary"]["fieldCount"] == 2


def test_self_managed_submission_does_not_require_payment(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        submission_ids = [
            item.id for item in session.exec(select(Submission).where(Submission.student_id == student.id)).all()
        ]
        if submission_ids:
            session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(submission_ids)))
        session.exec(delete(Submission).where(Submission.student_id == student.id))
        session.exec(delete(Order).where(Order.student_id == student.id))
        session.commit()

    res = client.post(
        "/api/v1/submissions/self-managed",
        json={"experiment_id": "exp_e2e_flow_unique", "image_paths": ["/uploads/self-managed.jpg"]},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    submission = res.json()
    assert submission["status"] == "incomplete"
    assert submission["payment_status"] == "not_required"
    assert submission["is_one_click_handoff"] is False
    assert submission["order_id"] is None

    res = client.patch(
        f"/api/v1/submissions/{submission['id']}/correction",
        json={
            "corrected_json": {"values": {"A": "1"}},
            "image_paths": ["/uploads/self-managed.jpg"],
            "save_mode": "final",
        },
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "submitting"

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        orders = session.exec(select(Order).where(Order.student_id == student.id)).all()
        assert orders == []


def test_school_submit_job_keeps_submission_unconfirmed_until_real_school_status(student_token, monkeypatch):
    def fake_submit_failure(job_id, submission_id, mode):
        with next(get_session()) as session:
            job = session.get(AutomationJob, job_id)
            submission = session.get(Submission, submission_id)
            job.status = "failed"
            job.public_status = "failed"
            job.public_message_code = "school.submit.failed"
            job.public_message_params = {"reason": "学校系统未确认临时提交状态"}
            job.error_code = "SCHOOL_STATUS_NOT_CONFIRMED"
            job.error_message = "学校系统未确认临时提交状态"
            job.finished_at = get_utc_now()
            job.updated_at = get_utc_now()
            if submission:
                submission.status = "error"
                submission.updated_at = get_utc_now()
                session.add(submission)
            session.add(job)
            session.commit()

    monkeypatch.setattr(school_sync, "run_school_experiment_submit", fake_submit_failure)

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        submission_ids = [
            item.id for item in session.exec(select(Submission).where(Submission.student_id == student.id)).all()
        ]
        if submission_ids:
            session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(submission_ids)))
        session.exec(delete(Submission).where(Submission.student_id == student.id))
        session.commit()

    res = client.post(
        "/api/v1/submissions/self-managed",
        json={"experiment_id": "exp_e2e_flow_unique", "image_paths": []},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    submission = res.json()

    res = client.patch(
        f"/api/v1/submissions/{submission['id']}/correction",
        json={
            "corrected_json": {
                "values": {"A": "1"},
                "experiment_id": "exp_e2e_flow_unique",
                "experiment_name": "Test Exp E2E",
            },
            "image_paths": [],
            "save_mode": "draft",
        },
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text

    res = client.post(
        "/api/v1/school-sync/experiments/exp_e2e_flow_unique/submit",
        json={"submissionId": submission["id"], "mode": "final"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["action"] == "final_submit"
    assert "requestPayload" not in job
    assert "sensitivePayload" not in job

    res = client.get(
        f"/api/v1/automation-jobs/{job['jobId']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    final_job = res.json()
    assert final_job["status"] == "failed"
    assert final_job["messageCode"] == "school.submit.failed"
    assert final_job["messageParams"]["reason"] == "学校系统未确认临时提交状态"

    with next(get_session()) as session:
        saved = session.get(Submission, submission["id"])
        assert saved.status == "error"
        versions = session.exec(
            select(SubmissionVersion).where(SubmissionVersion.submission_id == submission["id"])
        ).all()
        assert len(versions) == 1
        assert versions[0].source == "platform_before_submit"
        assert versions[0].snapshot_json["mode"] == "final"


def test_school_submit_success_can_be_confirmed_by_feedback_only(student_token, monkeypatch):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        submission_ids = [
            item.id for item in session.exec(select(Submission).where(Submission.student_id == student.id)).all()
        ]
        if submission_ids:
            session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(submission_ids)))
        session.exec(delete(Submission).where(Submission.student_id == student.id))
        submission = Submission(
            id="SUB-FEEDBACK-ONLY",
            student_id=student.id,
            experiment_id="exp_e2e_flow_unique",
            status="submitting",
            payment_status="not_required",
            corrected_json={"experiment_name": "Test Exp E2E", "values": {"A": "1"}},
        )
        session.add(submission)
        session.flush()
        job = AutomationJob(
            id="JOB-FEEDBACK-ONLY",
            actor_user_id=student.id,
            action="draft_submit",
            status="running",
            public_status="running",
            public_message_code="school.submit.saving",
            submission_id=submission.id,
            experiment_id=submission.experiment_id,
        )
        session.add(job)
        session.commit()

    def fake_run(coro):
        coro.close()
        opened = SchoolReportOpenResult(
            experiment_name="Test Exp E2E",
            school_status={"experimentName": "Test Exp E2E", "originalStatusText": "未提交", "schoolStatus": "school_not_submitted"},
            snapshot={"source": "school_report_modal", "values": {}},
            summary={"source": "school_report_modal"},
            artifacts={},
            session_diagnostic={"reuseDecision": "reused_current_report_modal"},
        )
        return {
            "opened": opened,
            "feedback": ["提交成功!"],
            "submitAccepted": True,
            "statusConfirmation": "feedback_only",
            "status": {"experimentName": "Test Exp E2E", "originalStatusText": "未提交", "schoolStatus": "school_not_submitted"},
            "statusError": None,
            "artifacts": {},
            "sessionDiagnostic": {"reuseDecision": "reused_current_report_modal"},
        }

    monkeypatch.setattr(school_report_sync_service.school_session_manager, "run", fake_run)

    school_report_sync_service.run_school_experiment_submit("JOB-FEEDBACK-ONLY", "SUB-FEEDBACK-ONLY", "draft")

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-FEEDBACK-ONLY")
        submission = session.get(Submission, "SUB-FEEDBACK-ONLY")
        snapshot = session.exec(
            select(SchoolSyncSnapshot)
            .where(SchoolSyncSnapshot.automation_job_id == "JOB-FEEDBACK-ONLY")
        ).first()
        assert job.status == "succeeded"
        assert job.result_payload["submitAccepted"] is True
        assert job.result_payload["statusConfirmation"] == "feedback_only"
        assert submission.status == "draft_submitted"
        assert snapshot.summary_json["statusConfirmation"] == "feedback_only"


def test_school_final_submit_success_updates_submission_completed(student_token, monkeypatch):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        submission_ids = [
            item.id for item in session.exec(select(Submission).where(Submission.student_id == student.id)).all()
        ]
        if submission_ids:
            session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(submission_ids)))
        session.exec(delete(Submission).where(Submission.student_id == student.id))
        submission = Submission(
            id="SUB-FINAL-SUCCESS",
            student_id=student.id,
            experiment_id="exp_e2e_flow_unique",
            status="submitting",
            payment_status="not_required",
            corrected_json={"experiment_name": "Test Exp E2E", "values": {"A": "1"}},
        )
        session.add(submission)
        session.flush()
        job = AutomationJob(
            id="JOB-FINAL-SUCCESS",
            actor_user_id=student.id,
            action="final_submit",
            status="running",
            public_status="running",
            public_message_code="school.submit.saving",
            submission_id=submission.id,
            experiment_id=submission.experiment_id,
        )
        session.add(job)
        session.commit()

    def fake_run(coro):
        coro.close()
        opened = SchoolReportOpenResult(
            experiment_name="Test Exp E2E",
            school_status={"experimentName": "Test Exp E2E", "originalStatusText": "临时提交", "schoolStatus": "school_draft_submitted"},
            snapshot={"source": "school_report_modal", "values": {}},
            summary={"source": "school_report_modal"},
            artifacts={},
            session_diagnostic={"reuseDecision": "reused_current_report_modal"},
        )
        return {
            "opened": opened,
            "feedback": ["提交成功!"],
            "submitAccepted": True,
            "statusConfirmation": "list_confirmed",
            "status": {"experimentName": "Test Exp E2E", "originalStatusText": "正常提交", "schoolStatus": "school_final_submitted"},
            "statusError": None,
            "artifacts": {},
            "sessionDiagnostic": {"reuseDecision": "reused_current_report_modal"},
        }

    monkeypatch.setattr(school_report_sync_service.school_session_manager, "run", fake_run)

    school_report_sync_service.run_school_experiment_submit("JOB-FINAL-SUCCESS", "SUB-FINAL-SUCCESS", "final")

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-FINAL-SUCCESS")
        submission = session.get(Submission, "SUB-FINAL-SUCCESS")
        snapshot = session.exec(
            select(SchoolSyncSnapshot)
            .where(SchoolSyncSnapshot.automation_job_id == "JOB-FINAL-SUCCESS")
        ).first()
        assert job.status == "succeeded"
        assert job.result_payload["submitAccepted"] is True
        assert job.result_payload["statusConfirmation"] == "list_confirmed"
        assert submission.status == "completed"
        assert snapshot.summary_json["mode"] == "final"
        assert snapshot.summary_json["schoolStatus"] == "school_final_submitted"


def test_school_submit_failure_audit_keeps_structured_diagnostics(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AuditLog).where(AuditLog.user_id == student.id))
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        submission = Submission(
            id="SUB-STRUCTURED-FAIL",
            student_id=student.id,
            experiment_id="exp_meter_modification",
            status="submitting",
            payment_status="not_required",
            corrected_json={"values": {"skt0Area": "你好"}},
        )
        existing_submission = session.get(Submission, submission.id)
        if existing_submission:
            session.delete(existing_submission)
            session.flush()
        session.add(submission)
        session.flush()
        job = AutomationJob(
            id="JOB-STRUCTURED-FAIL",
            actor_user_id=student.id,
            action="draft_submit",
            status="running",
            public_status="running",
            public_message_code="school.submit.confirming",
            submission_id=submission.id,
            experiment_id=submission.experiment_id,
        )
        session.add(job)
        session.commit()

        error = SchoolAutomationError(
            "SUBMIT_REJECTED_BY_SCHOOL",
            "学校系统返回提交失败",
            current_step="school.submit.confirming",
            message=json.dumps(
                {
                    "feedback": ["实验问题未填写完整，提交失败"],
                    "fieldWriteReport": {
                        "succeededFields": [{"nodeId": "skt0Area", "targetType": "wysiwyg_text"}],
                        "skippedEmptyFields": [],
                        "missingFields": [{"nodeId": "YSSJDrawingAreaArea", "reason": "platform_value_without_automation_mapping"}],
                        "failedFields": [],
                        "unsupportedFields": [],
                        "mappingAudit": [],
                    },
                    "artifacts": {"before_submit_modal_html": "/tmp/before.html"},
                },
                ensure_ascii=False,
            ),
        )
        school_report_sync_service._mark_job_failed(session, job, error)
        session.commit()

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-STRUCTURED-FAIL")
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "JOB-STRUCTURED-FAIL")
            .where(AuditLog.action == "draft_submit_failed")
        ).first()
        assert job.result_payload["feedback"] == ["实验问题未填写完整，提交失败"]
        assert job.result_payload["fieldWriteReport"]["missingFields"][0]["nodeId"] == "YSSJDrawingAreaArea"
        details = json.loads(log.details)
        assert details["errorCode"] == "SUBMIT_REJECTED_BY_SCHOOL"
        assert details["feedback"] == ["实验问题未填写完整，提交失败"]
        assert details["fieldWriteSummary"]["missingCount"] == 1
        assert details["artifacts"]["before_submit_modal_html"] == "/tmp/before.html"


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
