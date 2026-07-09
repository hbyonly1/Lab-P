import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select
from sqlalchemy import delete, or_, update
import sys
import os
import json
import asyncio
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from main import app
from api.v1 import school_sync
from api.v1 import submissions as submissions_api
from api.v1.automation_config import CONFIG_SCHEMA_VERSION, default_automation_config
from core.config import settings
from core.db import get_session
from models.core import Experiment, User, Order, OrderItem, Submission, SubmissionDraft, SubmissionVersion, AuditLog, AiTaskRun, AutomationEngineConfig, AutomationJob, SchoolSyncSnapshot, UploadedFile, Feedback, AiConfig, get_utc_now
from core.security import get_password_hash
from core.school_password import decrypt_school_password, encrypt_school_password
from services.automation_job_service import (
    AutomationJobConflict,
    create_or_reuse_automation_job,
    make_idempotency_key,
)
from services.school_overview_sync import SchoolAutomationError, check_login_error_feedback, extract_captcha_candidate, extract_report_list, mark_overview_failed, school_login_password_for_user
import services.school_report_sync as school_report_sync_service
import services.submission_preprocess as submission_preprocess_service
from services.school_report_sync import SchoolReportOpenResult
from services.school_dom import wait_for_locator_value
from services.school_session_manager import SchoolSessionManager, school_session_manager

client = TestClient(app)

STUDENT_NO = "26A2511111111"
FREE_STUDENT_NO = "26A2522222222"
E2E_TEST_STUDENT_NOS = {
    STUDENT_NO,
    FREE_STUDENT_NO,
    "26A2512345678",
    "26A2577777777",
    "26A2599999999",
    "26A2410410114",
}
E2E_TEST_USERNAMES = {
    *E2E_TEST_STUDENT_NOS,
    "student_e2e_flow",
    "student_free_flow",
    "admin_e2e_flow",
}
E2E_TEST_EXPERIMENT_IDS = {
    "exp_e2e_flow_unique",
    "exp_empty_image_guard",
    "exp_price_a",
    "exp_price_b",
    "exp_pro_batch_a",
    "exp_pro_batch_b",
    "exp_e2e_visible_config",
    "exp_e2e_hidden_config",
}
TINY_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR"
    b"\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00"
    b"\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


def delete_user_audit_logs(session: Session, user_id: int) -> None:
    session.exec(delete(AiTaskRun).where(AiTaskRun.user_id == user_id))
    session.exec(delete(AuditLog).where(AuditLog.user_id == user_id))


def delete_student_flow_data(session: Session, student_id: int) -> None:
    submission_ids = [
        item.id for item in session.exec(select(Submission).where(Submission.student_id == student_id)).all()
    ]
    order_ids = [item.id for item in session.exec(select(Order).where(Order.student_id == student_id)).all()]

    delete_user_audit_logs(session, student_id)
    session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student_id))
    session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student_id))
    if submission_ids:
        automation_job_ids = [
            item.id for item in session.exec(
                select(AutomationJob).where(AutomationJob.submission_id.in_(submission_ids))
            ).all()
        ]
        if automation_job_ids:
            session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.automation_job_id.in_(automation_job_ids)))
            session.exec(delete(AutomationJob).where(AutomationJob.id.in_(automation_job_ids)))
        session.exec(delete(AiTaskRun).where(AiTaskRun.submission_id.in_(submission_ids)))
        session.exec(delete(AiTaskRun).where(AiTaskRun.target_id.in_(submission_ids)))
        session.exec(delete(OrderItem).where(OrderItem.submission_id.in_(submission_ids)))
        session.exec(delete(SubmissionDraft).where(SubmissionDraft.submission_id.in_(submission_ids)))
        session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(submission_ids)))
        session.exec(delete(AuditLog).where(AuditLog.target_id.in_(submission_ids)))
        session.exec(delete(Submission).where(Submission.student_id == student_id))
    if order_ids:
        session.exec(delete(OrderItem).where(OrderItem.order_id.in_(order_ids)))
        session.exec(delete(AuditLog).where(AuditLog.target_id.in_(order_ids)))
        session.exec(delete(Order).where(Order.student_id == student_id))


def cleanup_e2e_artifacts(session: Session) -> None:
    test_users = session.exec(
        select(User).where(
            or_(
                User.username.in_(list(E2E_TEST_USERNAMES)),
                User.student_no.in_(list(E2E_TEST_STUDENT_NOS)),
            )
        )
    ).all()
    test_user_ids = [user.id for user in test_users]
    test_experiment_ids = list(E2E_TEST_EXPERIMENT_IDS)

    submission_filters = [Submission.experiment_id.in_(test_experiment_ids)]
    order_filters = [Order.experiment_id.in_(test_experiment_ids)]
    if test_user_ids:
        submission_filters.append(Submission.student_id.in_(test_user_ids))
        submission_filters.append(Submission.submitted_by.in_(test_user_ids))
        order_filters.append(Order.student_id.in_(test_user_ids))

    submissions = session.exec(select(Submission).where(or_(*submission_filters))).all()
    submission_ids = [submission.id for submission in submissions]
    submission_order_ids = [submission.order_id for submission in submissions if submission.order_id]

    order_filters.append(Order.id.in_(submission_order_ids or ["__none__"]))
    orders = session.exec(select(Order).where(or_(*order_filters))).all()
    order_ids = [order.id for order in orders]

    job_filters = [AutomationJob.experiment_id.in_(test_experiment_ids)]
    if test_user_ids:
        job_filters.append(AutomationJob.actor_user_id.in_(test_user_ids))
    if submission_ids:
        job_filters.append(AutomationJob.submission_id.in_(submission_ids))
    jobs = session.exec(select(AutomationJob).where(or_(*job_filters))).all()
    job_ids = [job.id for job in jobs]

    snapshot_filters = [SchoolSyncSnapshot.experiment_id.in_(test_experiment_ids)]
    if test_user_ids:
        snapshot_filters.append(SchoolSyncSnapshot.user_id.in_(test_user_ids))
    if submission_ids:
        snapshot_filters.append(SchoolSyncSnapshot.submission_id.in_(submission_ids))
    if job_ids:
        snapshot_filters.append(SchoolSyncSnapshot.automation_job_id.in_(job_ids))
    session.exec(delete(SchoolSyncSnapshot).where(or_(*snapshot_filters)))

    ai_filters = [
        AiTaskRun.experiment_id.in_(test_experiment_ids),
        AiTaskRun.target_id.in_(test_experiment_ids),
    ]
    if test_user_ids:
        ai_filters.append(AiTaskRun.user_id.in_(test_user_ids))
    if submission_ids:
        ai_filters.append(AiTaskRun.submission_id.in_(submission_ids))
        ai_filters.append(AiTaskRun.target_id.in_(submission_ids))
    session.exec(delete(AiTaskRun).where(or_(*ai_filters)))

    audit_target_ids = set(test_experiment_ids) | set(submission_ids) | set(order_ids) | set(job_ids)
    audit_filters = []
    if test_user_ids:
        audit_filters.append(AuditLog.user_id.in_(test_user_ids))
    if audit_target_ids:
        audit_filters.append(AuditLog.target_id.in_(list(audit_target_ids)))
    if audit_filters:
        session.exec(delete(AuditLog).where(or_(*audit_filters)))

    if test_user_ids:
        session.exec(delete(UploadedFile).where(UploadedFile.user_id.in_(test_user_ids)))

    order_item_filters = [OrderItem.experiment_id.in_(test_experiment_ids)]
    if order_ids:
        order_item_filters.append(OrderItem.order_id.in_(order_ids))
    if submission_ids:
        order_item_filters.append(OrderItem.submission_id.in_(submission_ids))
    session.exec(delete(OrderItem).where(or_(*order_item_filters)))

    if job_ids:
        session.exec(delete(AutomationJob).where(AutomationJob.id.in_(job_ids)))

    if submission_ids:
        session.exec(delete(SubmissionDraft).where(SubmissionDraft.submission_id.in_(submission_ids)))
        session.exec(delete(SubmissionVersion).where(SubmissionVersion.submission_id.in_(submission_ids)))
        session.exec(delete(Submission).where(Submission.id.in_(submission_ids)))

    if order_ids:
        session.exec(delete(Order).where(Order.id.in_(order_ids)))

    if test_user_ids:
        session.exec(
            update(AutomationEngineConfig)
            .where(AutomationEngineConfig.created_by.in_(test_user_ids))
            .values(created_by=None)
        )
        session.exec(
            update(AutomationEngineConfig)
            .where(AutomationEngineConfig.updated_by.in_(test_user_ids))
            .values(updated_by=None)
        )
        session.exec(
            update(AiConfig)
            .where(AiConfig.updated_by.in_(test_user_ids))
            .values(updated_by=None)
        )
        session.exec(
            update(SubmissionDraft)
            .where(SubmissionDraft.updated_by.in_(test_user_ids))
            .values(updated_by=None)
        )
        session.exec(
            update(SubmissionVersion)
            .where(SubmissionVersion.created_by.in_(test_user_ids))
            .values(created_by=None)
        )
        session.exec(delete(Feedback).where(Feedback.user_id.in_(test_user_ids)))
        session.exec(delete(User).where(User.id.in_(test_user_ids)))

    session.exec(delete(Experiment).where(Experiment.id.in_(test_experiment_ids)))
    session.flush()


AUTOMATION_CONFIG_SNAPSHOT_FIELDS = [
    "id",
    "name",
    "config_json",
    "schema_version",
    "is_active",
    "created_by",
    "updated_by",
    "created_at",
    "updated_at",
]


def _snapshot_automation_configs():
    with next(get_session()) as session:
        configs = session.exec(select(AutomationEngineConfig).order_by(AutomationEngineConfig.id)).all()
        return [
            {
                field: (
                    json.loads(json.dumps(getattr(config, field) or {}))
                    if field == "config_json"
                    else getattr(config, field)
                )
                for field in AUTOMATION_CONFIG_SNAPSHOT_FIELDS
            }
            for config in configs
        ]


def _restore_automation_configs(snapshot):
    with next(get_session()) as session:
        existing_user_ids = set(session.exec(select(User.id)).all())
        session.exec(delete(AutomationEngineConfig))
        session.flush()
        for item in snapshot:
            restored = dict(item)
            if restored.get("created_by") not in existing_user_ids:
                restored["created_by"] = None
            if restored.get("updated_by") not in existing_user_ids:
                restored["updated_by"] = None
            session.add(AutomationEngineConfig(**restored))
        session.commit()


@pytest.fixture
def preserve_automation_config():
    snapshot = _snapshot_automation_configs()
    try:
        yield
    finally:
        _restore_automation_configs(snapshot)


AI_CONFIG_TEST_FIELDS = [
    "provider",
    "base_url",
    "default_model",
    "default_timeout_seconds",
    "default_temperature",
    "default_max_images_per_task",
    "auto_recognize",
    "image_recognition_model",
    "image_recognition_retry_enabled",
    "image_recognition_timeout_seconds",
    "image_recognition_temperature",
    "image_recognition_max_images_per_task",
    "answer_generation_model",
    "answer_generation_timeout_seconds",
    "answer_generation_temperature",
    "captcha_model",
    "captcha_timeout_seconds",
    "captcha_temperature",
    "captcha_prompt",
    "task_overrides_json",
    "updated_by",
]


def _snapshot_ai_config():
    from services.ai_provider import ensure_ai_config

    with next(get_session()) as session:
        config = ensure_ai_config(session)
        snapshot = {field: getattr(config, field) for field in AI_CONFIG_TEST_FIELDS}
        session.commit()
        return snapshot


def _restore_ai_config(snapshot):
    from services.ai_provider import ensure_ai_config

    with next(get_session()) as session:
        config = ensure_ai_config(session)
        for field, value in snapshot.items():
            setattr(config, field, value)
        session.add(config)
        session.commit()


@pytest.fixture
def preserve_ai_config():
    snapshot = _snapshot_ai_config()
    try:
        yield
    finally:
        _restore_ai_config(snapshot)


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

    async def screenshot(self, path):
        with open(path, "wb") as handle:
            handle.write(b"fake screenshot")

    async def evaluate(self, script, *_args):
        if self.page and hasattr(self.page, "evaluate_locator"):
            result = self.page.evaluate_locator(self.selector, script)
            if asyncio.iscoroutine(result):
                return await result
            return result
        return ""


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


class FakeBootboxPage(FakeSchoolPage):
    def __init__(self, body_text="error"):
        super().__init__()
        self.body_text = body_text

    def locator(self, selector):
        if selector == ".bootbox" or ".bootbox" in selector:
            return FakeLocator(1, page=self, selector=selector)
        return super().locator(selector)

    async def evaluate(self, script, _args=None):
        if ".bootbox" in script:
            return {
                "className": "bootbox modal in",
                "id": "",
                "ariaHidden": "false",
                "bodyText": self.body_text,
                "textPreview": f"× {self.body_text}",
            }
        return None

    def evaluate_locator(self, selector, _script):
        if ".bootbox" in selector:
            return f'<div class="bootbox modal in"><div class="bootbox-body">{self.body_text}</div></div>'
        return ""

    async def screenshot(self, path, full_page=True):
        with open(path, "wb") as handle:
            handle.write(b"fake page screenshot")

    async def content(self):
        return f'<html><body><div class="bootbox"><div class="bootbox-body">{self.body_text}</div></div></body></html>'


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


def test_experiment_configs_have_automation_mappings_for_configured_nodes():
    config_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "configs")
    for filename in sorted(os.listdir(config_dir)):
        if not filename.endswith(".json"):
            continue
        with open(os.path.join(config_dir, filename), "r", encoding="utf-8") as handle:
            config = json.load(handle)
        fields = (config.get("inputs") or {}).get("fields") or []
        field_by_id = {field.get("id"): field for field in fields if field.get("id")}
        question_ids = {
            question.get("nodeId")
            for question in ((config.get("ui") or {}).get("questions") or [])
            if question.get("nodeId")
        }
        mappings = ((config.get("automation") or {}).get("mappings") or [])
        mapping_by_source = {mapping.get("sourceId"): mapping for mapping in mappings}

        assert len(mapping_by_source) == len(mappings), f"{filename} has duplicate automation mapping sourceId"

        for image in (config.get("inputs") or {}).get("images") or []:
            target_node_id = image.get("targetNodeId")
            if target_node_id:
                assert target_node_id in field_by_id, f"{filename} image targetNodeId missing field: {target_node_id}"

        required_ids = set(field_by_id) | question_ids
        missing_ids = sorted(required_ids - set(mapping_by_source))
        assert missing_ids == [], f"{filename} missing automation mappings: {missing_ids}"

        for source_id in required_ids:
            mapping = mapping_by_source[source_id]
            assert mapping.get("targetLocator") == f"#{source_id}", f"{filename} {source_id} targetLocator mismatch"
            field_type = (field_by_id.get(source_id) or {}).get("type")
            if field_type == "image_upload":
                assert mapping.get("targetType") == "wysiwyg_image", f"{filename} {source_id} should be wysiwyg_image"
            elif source_id in question_ids:
                assert mapping.get("targetType") == "wysiwyg_text", f"{filename} {source_id} should be wysiwyg_text"
            else:
                assert mapping.get("targetType") in [None, "text"], f"{filename} {source_id} unexpected targetType"


def test_computed_asset_image_slots_are_marked_auto_generated():
    config_dir = Path(__file__).resolve().parents[1] / "configs"
    for path in config_dir.glob("*.json"):
        config = json.loads(path.read_text(encoding="utf-8"))
        computed_assets = config.get("computedAssets") or {}
        generated_slot_ids = {
            str(asset.get("imageSlotId"))
            for asset in computed_assets.values()
            if isinstance(asset, dict) and asset.get("imageSlotId")
        }
        if not generated_slot_ids:
            continue
        images = (config.get("inputs") or {}).get("images") or []
        image_by_id = {str(image.get("id")): image for image in images if image.get("id")}
        for slot_id in generated_slot_ids:
            assert slot_id in image_by_id, f"{path.name} computed asset imageSlotId missing image slot: {slot_id}"
            assert image_by_id[slot_id].get("autoGenerated") is True, (
                f"{path.name} computed asset image slot must set autoGenerated=true: {slot_id}"
            )


def test_image_assignment_candidates_exclude_computed_asset_slots():
    from core.image_assignment_prompts import build_image_assignment_candidates

    with next(get_session()) as session:
        experiment = session.get(Experiment, "exp_liquid_crystal_0625")
        candidates, candidate_map = build_image_assignment_candidates([experiment])

    slot_ids = {
        slot["slot_id"]
        for slot in candidate_map["slots"].values()
    }
    assert candidates
    assert "IMG_LC_SIGNED_RAW" in slot_ids
    assert "IMG_LC_FALL_CURVE" in slot_ids
    assert "IMG_LC_RISE_CURVE" in slot_ids
    assert "IMG_LC_AVG_CURVE" not in slot_ids

    slots = candidate_map["slots"]
    signed_raw = next(item for item in slots.values() if item["slot_id"] == "IMG_LC_SIGNED_RAW")
    assert signed_raw["kind"] == "ai_recognition"


def test_image_assignment_prompt_puts_tables_under_recognition_slots_only():
    from core.image_assignment_prompts import build_image_assignment_candidates, build_image_assignment_prompt

    with next(get_session()) as session:
        experiment = session.get(Experiment, "exp_liquid_crystal_0625")
        candidates, _candidate_map = build_image_assignment_candidates([experiment])

    prompt = build_image_assignment_prompt(candidates, image_count=4)
    assert "页面区域" not in prompt
    assert "AI识别用图片" not in prompt
    assert "单独上传图片" not in prompt
    assert "IMG_LC_AVG_CURVE" not in prompt
    assert "签字原始数据上传" not in prompt
    assert '"id": "E01",' not in prompt
    assert "- E01-S01" in prompt
    assert "液晶光开关数据表" in prompt
    assert "- E01-S02" in prompt
    assert "透光率下降相应曲线照片" in prompt


def test_image_assignment_candidates_include_only_oscilloscope_first_slot():
    from core.image_assignment_prompts import build_image_assignment_candidates, build_image_assignment_prompt

    with next(get_session()) as session:
        experiments = [
            session.get(Experiment, "exp_liquid_crystal_0625"),
            session.get(Experiment, "exp_oscilloscope"),
        ]
        candidates, candidate_map = build_image_assignment_candidates(experiments)

    prompt = build_image_assignment_prompt(candidates, image_count=3)
    assert "示波器的使用" in prompt
    assert "正弦波" in prompt
    assert "T(ms)" in prompt
    assert "拍周期(ms)" in prompt
    assert "f1= Hz" in prompt
    assert "f2= Hz" in prompt
    assert "李萨如" not in prompt
    oscilloscope_slots = [
        item for item in candidate_map["slots"].values()
        if item.get("experiment_id") == "exp_oscilloscope"
    ]
    assert len(oscilloscope_slots) == 1
    assert oscilloscope_slots[0]["slot_id"] == "IMG_RAW_DATA"


def test_auto_match_images_does_not_force_low_detail(monkeypatch):
    from types import SimpleNamespace
    from services import ai_service

    captured = {}

    class FakeProvider:
        async def chat_completion(self, **kwargs):
            captured["messages"] = kwargs["messages"]
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps({"slotCandidateId": "E01-S01"})
                        )
                    )
                ]
            )

    monkeypatch.setattr(ai_service, "get_ai_provider", lambda _session: FakeProvider())
    candidates = [
        {
            "candidateId": "E01",
            "name": "示波器的使用",
            "slots": [{"candidateId": "E01-S01", "label": "图片槽"}],
        }
    ]
    with next(get_session()) as session:
        result = asyncio.run(ai_service.auto_match_experiment_images(
            [{"index": 1, "url": "assets/configs_images/exp_oscilloscope_img_005.png"}],
            candidates,
            session,
        ))

    assert result["matches"][0]["imageIndex"] == 1
    image_items = [
        item
        for item in captured["messages"][0]["content"]
        if item.get("type") == "image_url"
    ]
    assert image_items
    assert all("detail" not in item["image_url"] for item in image_items)
    prompt = captured["messages"][0]["content"][0]["text"]
    assert "imageIndex" not in prompt


def test_auto_match_images_accepts_single_slot_id_response(monkeypatch):
    from types import SimpleNamespace
    from services import ai_service

    class FakeProvider:
        async def chat_completion(self, **kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps({"slotCandidateId": "E01-S01"})
                        )
                    )
                ]
            )

    monkeypatch.setattr(ai_service, "get_ai_provider", lambda _session: FakeProvider())
    candidates = [
        {
            "candidateId": "E01",
            "name": "测试实验",
            "slots": [{"candidateId": "E01-S01", "label": "图片槽"}],
        }
    ]
    with next(get_session()) as session:
        result = asyncio.run(ai_service.auto_match_experiment_images(
            [{"index": 1, "url": "assets/configs_images/exp_oscilloscope_img_005.png"}],
            candidates,
            session,
        ))

    assert result["matches"] == [
        {
            "imageIndex": 1,
            "slotCandidateId": "E01-S01",
        }
    ]
    assert result["unmatched"] == []


def test_auto_match_images_empty_slot_id_marks_unmatched(monkeypatch):
    from types import SimpleNamespace
    from services import ai_service

    class FakeProvider:
        async def chat_completion(self, **kwargs):
            return SimpleNamespace(
                choices=[
                    SimpleNamespace(
                        message=SimpleNamespace(
                            content=json.dumps({"slotCandidateId": ""})
                        )
                    )
                ]
            )

    monkeypatch.setattr(ai_service, "get_ai_provider", lambda _session: FakeProvider())
    candidates = [
        {
            "candidateId": "E01",
            "name": "测试实验",
            "slots": [{"candidateId": "E01-S01", "label": "图片槽"}],
        }
    ]
    with next(get_session()) as session:
        result = asyncio.run(ai_service.auto_match_experiment_images(
            [{"index": 8, "url": "assets/configs_images/exp_oscilloscope_img_005.png"}],
            candidates,
            session,
        ))

    assert result["matches"] == []
    assert result["unmatched"] == [{"imageIndex": 8}]


def test_auto_match_worker_matches_one_image_per_request(monkeypatch):
    from types import SimpleNamespace
    from worker import ai_tasks

    calls = []

    async def fake_auto_match(batch, _candidates, _session, include_debug=False):
        calls.append([item["index"] for item in batch])
        result = {
            "matches": [
                {
                    "imageIndex": item["index"],
                    "slotCandidateId": "E01-S01",
                }
                for item in batch
            ],
            "unmatched": [],
        }
        if include_debug:
            result["_debug"] = {
                "request": {"prompt": "测试 prompt", "images": batch},
                "raw_response": json.dumps(result, ensure_ascii=False),
                "parsed_response": {"matches": result["matches"], "unmatched": []},
                "normalized_result": {"matches": result["matches"], "unmatched": []},
            }
        return result

    class FakeProvider:
        def get_profile(self, *_args, **_kwargs):
            return SimpleNamespace(
                task="experiment_image_auto_match",
                model="fake-vl",
                base_url="https://example.invalid/v1",
                temperature=0,
                timeout_seconds=120,
                max_images_per_task=1,
                concurrency=3,
            )

    monkeypatch.setattr(ai_tasks.ai_service, "auto_match_experiment_images", fake_auto_match)
    monkeypatch.setattr(ai_tasks, "get_ai_provider", lambda _session: FakeProvider())
    image_items = [
        {"index": index, "url": f"/uploads/test-{index}.jpg"}
        for index in range(1, 13)
    ]
    candidates = [
        {
            "candidateId": "E01",
            "name": "测试实验",
            "slots": [{"candidateId": "E01-S01", "label": "图片槽"}],
        }
    ]
    candidate_map = {"experiments": {}, "slots": {}}
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        student_id = student.id

    result = ai_tasks.auto_match_experiment_images_task.apply(
        args=(image_items, candidates, candidate_map, student_id),
        task_id="TASK-IMAGE-AUTO-MATCH-BATCH",
    ).get()

    assert sorted(calls) == [[index] for index in range(1, 13)]
    assert len(result["matches"]) == 12
    assert result["unmatched"] == []
    artifact_path = Path(__file__).resolve().parents[1] / "tmp" / "ai_image_auto_match" / "TASK-IMAGE-AUTO-MATCH-BATCH" / "debug_payload.json"
    artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
    assert artifact["model"] == "fake-vl"
    assert artifact["base_url"] == "https://example.invalid/v1"
    assert artifact["batch_size"] == 1
    assert artifact["concurrency"] == 3
    assert artifact["request_count"] == 12
    assert artifact["batches"][0]["images"][0]["index"] == 1
    assert artifact["batches"][0]["ai_payload"]["request"]["prompt"] == "测试 prompt"
    assert artifact["batches"][0]["ai_payload"]["raw_response"]
    assert artifact["batches"][0]["ai_payload"]["parsed_response"]["matches"]
    assert artifact["final_result"]["matches"]

    with next(get_session()) as session:
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "experiment_image_auto_match")
            .where(AuditLog.action == "experiment_image_auto_match")
            .where(AuditLog.status == "success")
            .order_by(AuditLog.id.desc())
        ).first()
        log_details = json.loads(log.details)
    assert log_details["workspace_artifact_path"].endswith("debug_payload.json")
    assert log_details["batches"][0]["ai_payload"]["request"]["prompt"] == "测试 prompt"
    assert log_details["batches"][0]["ai_payload"]["raw_response"]
    assert log_details["final_result"]["matches"]


def test_falling_ball_viscosity_curve_is_configured_as_computed_asset():
    config_path = Path(__file__).resolve().parents[1] / "configs" / "exp_falling_ball_viscosity.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    asset = (config.get("computedAssets") or {}).get("L3Area")
    assert asset is not None
    assert asset.get("generator") == "canvas_plot"
    assert asset.get("imageSlotId") == "IMG_L3_CURVE"
    assert asset.get("plot", {}).get("title") == "粘滞系数η与温度T的关系曲线"
    assert asset.get("plot", {}).get("xAxis", {}).get("values") == [30, 33, 36, 39, 40, 42, 44, 46]
    assert asset.get("plot", {}).get("xAxis", {}).get("ticks") == [30, 32, 34, 36, 38, 40, 42, 44, 46]
    assert asset.get("plot", {}).get("yAxis", {}).get("tickDecimals") == 2
    assert asset.get("plot", {}).get("yAxis", {}).get("nodes") == [
        "L20-0",
        "L21-0",
        "L22-0",
        "L23-0",
        "L24-0",
        "L25-0",
        "L26-0",
        "L27-0",
    ]
    scatter_layer = [layer for layer in asset.get("plot", {}).get("layers", []) if layer.get("type") == "scatter"][0]
    assert scatter_layer.get("showInLegend") is False
    assert scatter_layer.get("valueLabels", {}).get("decimals") == 3


def test_compute_endpoint_resolves_formula_dependencies_in_one_request(admin_token):
    values = {
        "K10-0": 40,
        "K10-1": 60,
        "K10-2": 80,
        "K10-3": 100,
        "K10-4": 120,
        "K10-5": 140,
        "K10-6": 160,
        "K30-0": 60,
        "K30-1": 58,
        "K30-2": 62,
        "K30-3": 61,
        "K30-4": 59,
        "K30-5": 60,
        "K32-0": 30,
        "K32-1": 29,
        "K32-2": 31,
        "K32-3": 30.5,
        "K32-4": 29.5,
        "K32-5": 30,
        "K34-0": 101.325,
        "K34-1": 101.325,
        "K34-2": 101.325,
        "K34-3": 101.325,
        "K34-4": 101.325,
        "K34-5": 101.325,
        "K35-0": "999",
        "K37-0": "1.500",
        "K37-1": "1.500",
        "K37-2": "1.500",
        "K37-3": "1.500",
        "K37-4": "1.500",
        "K37-5": "1.500",
    }

    res = client.post(
        "/api/v1/experiments/exp_air_heat_capacity_ratio/compute",
        json={"current_form_values": values},
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert res.status_code == 200, res.text
    computed = res.json()["computed_values"]
    assert computed["K2"] == "20.00"
    assert computed["K35-0"] == "999"
    assert "K36-0" not in computed
    assert computed["K37-0"] == "1.500"
    assert computed["K4"] == "1.500"
    assert computed["K5"] == "0.00"


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


def test_blocking_bootbox_guard_raises_structured_error(tmp_path, monkeypatch):
    monkeypatch.setattr(school_report_sync_service, "ARTIFACT_ROOT", tmp_path)
    page = FakeBootboxPage("error")

    with pytest.raises(SchoolAutomationError) as exc_info:
        asyncio.run(
            school_report_sync_service._raise_if_blocking_bootbox(
                page,
                job_id="JOB-BOOTBOX",
                current_step="school.detail.opening",
                phase="before_open_report",
            )
        )

    error = exc_info.value
    detail = json.loads(error.message)
    assert error.error_code == "SCHOOL_BOOTBOX_ERROR"
    assert error.current_step == "school.detail.opening"
    assert "error" in error.reason
    assert detail["phase"] == "before_open_report"
    assert detail["bootbox"]["bodyText"] == "error"
    assert os.path.exists(detail["artifacts"]["before_open_report_bootbox_html"])


def test_extract_report_list_uses_paper_name_column_by_default():
    items = asyncio.run(extract_report_list(FakeReportListColumnsPage(), default_automation_config(), timeout_ms=1000))
    assert items[0]["experimentName"] == "液晶电光效应实验0625"
    assert items[0]["schoolStatus"] == "school_not_submitted"


@pytest.fixture(scope="session", autouse=True)
def setup_test_data():
    """Ensure test data exists in the DB"""
    automation_config_snapshot = _snapshot_automation_configs()
    with next(get_session()) as session:
        cleanup_e2e_artifacts(session)
        if not session.get(Experiment, "exp_e2e_flow_unique"):
            session.add(Experiment(id="exp_e2e_flow_unique", title="Test Exp E2E"))

        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        if not student:
            student = User(
                username=STUDENT_NO,
                student_no=STUDENT_NO,
                hashed_password=get_password_hash(STUDENT_NO),
                encrypted_school_password=encrypt_school_password(STUDENT_NO),
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
                encrypted_school_password=encrypt_school_password(FREE_STUDENT_NO),
                role="student",
            )
            session.add(student_free)
            session.flush()
            
        admin = session.exec(select(User).where(User.username == "admin_e2e_flow")).first()
        if not admin:
            admin = User(username="admin_e2e_flow", hashed_password=get_password_hash("password"), role="admin")
            session.add(admin)
            
        session.commit()
    yield
    with next(get_session()) as session:
        cleanup_e2e_artifacts(session)
        session.commit()
    _restore_automation_configs(automation_config_snapshot)

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


def test_student_login_creates_user_with_encrypted_school_password():
    student_no = "26A2512345678"
    plain_password = "changed-school-password"
    with next(get_session()) as session:
        existing = session.exec(select(User).where(User.student_no == student_no)).first()
        if existing:
            delete_student_flow_data(session, existing.id)
            delete_user_audit_logs(session, existing.id)
            session.delete(existing)
            session.commit()

    res = client.post("/api/v1/auth/login", data={"username": student_no, "password": plain_password})
    assert res.status_code == 200, res.text

    with next(get_session()) as session:
        user = session.exec(select(User).where(User.student_no == student_no)).first()
        assert user is not None
        assert user.encrypted_school_password
        assert user.encrypted_school_password != plain_password
        assert decrypt_school_password(user.encrypted_school_password) == plain_password
        assert school_login_password_for_user(user) == plain_password

    bad_res = client.post("/api/v1/auth/login", data={"username": student_no, "password": student_no})
    assert bad_res.status_code == 400


def test_login_preview_marks_first_student_login_for_confirmation():
    student_no = "26A2599999999"
    with next(get_session()) as session:
        existing = session.exec(select(User).where(User.student_no == student_no)).first()
        if existing:
            delete_student_flow_data(session, existing.id)
            delete_user_audit_logs(session, existing.id)
            session.delete(existing)
            session.commit()

    res = client.post("/api/v1/auth/login-preview", json={"username": student_no})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["username"] == student_no
    assert data["is_student_login"] is True
    assert data["account_exists"] is False
    assert data["requires_school_credential_confirmation"] is True

    existing_res = client.post("/api/v1/auth/login-preview", json={"username": STUDENT_NO})
    assert existing_res.status_code == 200, existing_res.text
    existing_data = existing_res.json()
    assert existing_data["is_student_login"] is True
    assert existing_data["account_exists"] is True
    assert existing_data["requires_school_credential_confirmation"] is False

    admin_res = client.post("/api/v1/auth/login-preview", json={"username": "admin_e2e_flow"})
    assert admin_res.status_code == 200, admin_res.text
    admin_data = admin_res.json()
    assert admin_data["is_student_login"] is False
    assert admin_data["requires_school_credential_confirmation"] is False


def test_admin_can_upsert_student_and_read_student_management(admin_token, monkeypatch):
    student_no = "26A2577777777"
    plain_password = "admin-added-school-password"
    with next(get_session()) as session:
        existing = session.exec(select(User).where(User.student_no == student_no)).first()
        if existing:
            delete_student_flow_data(session, existing.id)
            delete_user_audit_logs(session, existing.id)
            session.delete(existing)
            session.commit()

    res = client.post(
        "/api/v1/admin/students",
        json={"studentNo": student_no, "password": plain_password},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["studentNo"] == student_no
    assert body["summary"]["totalExperimentCount"] >= 0
    assert isinstance(body["experiments"], list)

    with next(get_session()) as session:
        user = session.exec(select(User).where(User.student_no == student_no)).first()
        assert user is not None
        assert decrypt_school_password(user.encrypted_school_password) == plain_password

    res = client.get("/api/v1/admin/students", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    assert any(item["studentNo"] == student_no for item in res.json()["items"])

    res = client.post(
        f"/api/v1/admin/students/{body['id']}/experiments/exp_meter_modification/edit-submission",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    submission = res.json()
    assert submission["student_id"] == body["id"]
    assert submission["experiment_id"] == "exp_meter_modification"
    assert submission["status"] == "incomplete"
    assert submission["is_one_click_handoff"] is False

    def fake_completion_check(job_id: str, user_id: int) -> None:
        with next(get_session()) as session:
            job = session.get(AutomationJob, job_id)
            student = session.get(User, user_id)
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.completion.success"
            job.result_payload = {
                "completionCheck": {
                    "studentId": user_id,
                    "studentNo": student.student_no,
                    "realName": student.real_name,
                    "summary": {
                        "experimentCount": 2,
                        "checkedExperimentCount": 1,
                        "completeExperimentCount": 0,
                        "incompleteExperimentCount": 1,
                        "skippedExperimentCount": 1,
                        "missingCount": 1,
                    },
                    "experiments": [
                        {
                            "experimentId": "exp_meter_modification",
                            "experimentName": "电表的改装",
                            "schoolStatus": "school_draft_submitted",
                            "originalStatusText": "已临时提交",
                            "checkStatus": "checked",
                            "complete": False,
                            "missing": [{"key": "node-1", "label": "节点1"}],
                        },
                        {
                            "experimentId": "exp_skipped",
                            "experimentName": "未提交实验",
                            "schoolStatus": "school_not_submitted",
                            "originalStatusText": "未提交",
                            "checkStatus": "skipped",
                            "complete": False,
                            "missing": [],
                            "reason": "学校状态未临时提交或正式提交，跳过检查",
                        },
                    ],
                }
            }
            job.finished_at = get_utc_now()
            job.updated_at = get_utc_now()
            session.add(job)
            session.commit()

    monkeypatch.setattr("api.v1.admin_students.run_school_completion_check", fake_completion_check)

    res = client.post(
        f"/api/v1/admin/students/{body['id']}/completion-check",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["action"] == "school_completion_check"

    res = client.get(
        f"/api/v1/admin/students/{body['id']}/completion-check/{job['jobId']}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    completion = res.json()
    assert completion["studentId"] == body["id"]
    assert completion["summary"]["checkedExperimentCount"] == 1
    assert completion["summary"]["skippedExperimentCount"] == 1
    assert completion["summary"]["missingCount"] == 1
    assert any(not item["complete"] for item in completion["experiments"])
    assert any(item["checkStatus"] == "skipped" for item in completion["experiments"])


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
    item = next((sub for sub in res.json()["items"] if sub["id"] == submission_id), None)
    assert item is not None
    assert item["student_no"] == FREE_STUDENT_NO
    assert item["real_name"] is None
    assert item["student_name"] is None

def test_student_payment_flow(student_token, admin_token):
    # 0. Mock uploading an image
    # We will simulate the frontend sending a mock image
    image_content = TINY_PNG_BYTES
    res = client.post(
        "/api/v1/files/upload",
        files={"file": ("test_image.png", image_content, "image/png")},
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 200, res.text
    upload_data = res.json()
    image_url = upload_data["url"]
    assert image_url.startswith("/uploads/")

    # 1. Student creates one checkout order with one submission.
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "is_hungup": True,
            "experiments": [{"experiment_id": "exp_e2e_flow_unique", "image_paths": [image_url]}],
            "client_request_id": f"REQ-E2E-PAY-{os.urandom(4).hex()}",
        },
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 200, res.text
    checkout = res.json()
    submission = checkout["submissions"][0]
    order = checkout["order"]
    assert submission["status"] in ["pending_payment", "pending_image_assignment"]
    assert order["plan"] == "pay_per_use"
    assert len(order["items"]) == 1

    order_id = order["id"]
    
    # 2. Admin retrieves orders and sees the pending order
    res = client.get("/api/v1/orders/", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    orders = res.json()["items"]
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
    review_pool = res.json()["items"]
    sub_found = next((s for s in review_pool if s["id"] == submission["id"]), None)
    assert sub_found is not None
    assert sub_found["status"] == "pending_image_assignment"

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


def test_file_upload_requires_auth_and_real_image(student_token):
    res = client.post(
        "/api/v1/files/upload",
        files={"file": ("raw.png", TINY_PNG_BYTES, "image/png")},
    )
    assert res.status_code == 401, res.text

    res = client.post(
        "/api/v1/files/upload",
        files={"file": ("fake.jpg", b"fake_image_bytes", "image/jpeg")},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 415, res.text
    assert "不支持的图片格式" in res.json()["detail"]


def test_uploaded_file_private_view_requires_owner(student_token, free_student_token):
    res = client.post(
        "/api/v1/files/upload",
        files={"file": ("raw.png", TINY_PNG_BYTES, "image/png")},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    image_url = res.json()["url"]

    direct = client.get(image_url)
    assert direct.status_code == 404, direct.text

    own_view = client.get(
        "/api/v1/files/view",
        params={"path": image_url},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert own_view.status_code == 200, own_view.text
    assert own_view.content == TINY_PNG_BYTES

    other_view = client.get(
        "/api/v1/files/view",
        params={"path": image_url},
        headers={"Authorization": f"Bearer {free_student_token}"},
    )
    assert other_view.status_code == 403, other_view.text


def test_one_click_submission_requires_uploaded_images(student_token):
    experiment_id = "exp_empty_image_guard"
    with next(get_session()) as session:
        if not session.get(Experiment, experiment_id):
            session.add(Experiment(id=experiment_id, title="Empty Image Guard"))
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(Submission).where(Submission.student_id == student.id).where(Submission.experiment_id == experiment_id))
        before_order_count = len(session.exec(select(Order).where(Order.student_id == student.id)).all())
        session.commit()

    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "is_hungup": True,
            "experiments": [{"experiment_id": experiment_id, "image_paths": []}],
        },
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 400, res.text
    assert "至少需要上传一个实验图片" in res.json()["detail"]

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        after_order_count = len(session.exec(select(Order).where(Order.student_id == student.id)).all())
        submission = session.exec(select(Submission).where(Submission.student_id == student.id).where(Submission.experiment_id == experiment_id)).first()
        assert after_order_count == before_order_count
        assert submission is None


def test_student_cannot_modify_one_click_handoff_submission(student_token):
    submission_id = "SUB-STUDENT-HANDOFF-LOCK"
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        experiment = session.get(Experiment, "exp_e2e_flow_unique")
        if not experiment:
            session.add(Experiment(id="exp_e2e_flow_unique", title="E2E Experiment"))
        existing = session.get(Submission, submission_id)
        if existing:
            session.delete(existing)
            session.commit()
        session.add(Submission(
            id=submission_id,
            student_id=student.id,
            experiment_id="exp_e2e_flow_unique",
            status="pending_image_assignment",
            payment_status="paid",
            is_one_click_handoff=True,
            image_paths=["/uploads/security-handoff.png"],
            image_slots={},
        ))
        session.commit()

    res = client.patch(
        f"/api/v1/submissions/{submission_id}/draft",
        json={"draft_json": {"values": {"A": "1"}}, "image_paths": [], "image_slots": {}, "local_revision": 1},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 403, res.text

    res = client.patch(
        f"/api/v1/submissions/{submission_id}/correction",
        json={"corrected_json": {"values": {"A": "1"}}, "image_paths": [], "image_slots": {}, "save_mode": "draft"},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 403, res.text


def test_single_slot_pending_payment_auto_prepares_after_payment_verify(student_token, admin_token, monkeypatch):
    queued_submission_ids = []

    def fake_prepare_delay(submission_id, user_id):
        queued_submission_ids.append((submission_id, user_id))

    monkeypatch.setattr(submission_preprocess_service.prepare_submission_for_review_task, "delay", fake_prepare_delay, raising=False)

    experiment_id = "exp_meter_modification"
    image_url = "/uploads/e2e-single-slot-after-payment.jpg"
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_student_flow_data(session, student.id)
        session.commit()

    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "is_hungup": True,
            "experiments": [{"experiment_id": experiment_id, "image_paths": [image_url]}],
            "client_request_id": f"REQ-E2E-SINGLE-{os.urandom(4).hex()}",
        },
        headers={"Authorization": f"Bearer {student_token}"}
    )
    assert res.status_code == 200, res.text
    checkout = res.json()
    submission = checkout["submissions"][0]
    assert submission["status"] == "pending_payment"
    assert submission["image_slots"] == {}
    assert queued_submission_ids == []

    res = client.post(
        f"/api/v1/orders/{checkout['order']['id']}/verify",
        json={"action": "verify"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text

    res = client.get(f"/api/v1/submissions/{submission['id']}", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    updated = res.json()
    assert updated["payment_status"] == "paid"
    assert updated["status"] == "preparing_review"
    assert updated["preprocess_status"] == "queued"
    assert updated["image_slots"]["IMG_RAW_DATA"][0]["url"] == image_url
    assert [item[0] for item in queued_submission_ids] == [submission["id"]]


def test_one_click_batch_pay_per_use_uses_unified_experiment_price(student_token, admin_token):
    batch_id = f"BATCH-E2E-PRICE-{os.urandom(4).hex().upper()}"
    with next(get_session()) as session:
        for experiment_id, amount in [("exp_price_a", 11.0), ("exp_price_b", 17.0)]:
            experiment = session.get(Experiment, experiment_id)
            if not experiment:
                experiment = Experiment(id=experiment_id, title=experiment_id)
            experiment.config_json = {"pricing": {"oneClick": amount}}
            session.add(experiment)
        session.commit()

    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "is_hungup": True,
            "submission_batch_id": batch_id,
            "client_request_id": f"REQ-E2E-PRICE-{os.urandom(4).hex()}",
            "experiments": [
                {"experiment_id": "exp_price_a", "image_paths": ["/uploads/price-a.jpg"]},
                {"experiment_id": "exp_price_b", "image_paths": ["/uploads/price-b.jpg"]},
            ],
        },
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    checkout = res.json()
    order = checkout["order"]
    submissions = checkout["submissions"]
    assert order["plan"] == "pay_per_use"
    assert order["order_type"] == "one_click_batch"
    assert order["amount"] == 10.0
    assert order["submission_batch_id"] == batch_id
    assert len(submissions) == 2
    assert [item["total_amount"] for item in order["items"]] == [5.0, 5.0]
    assert {submission["order_id"] for submission in submissions} == {order["id"]}

    res = client.post(
        f"/api/v1/orders/{order['id']}/verify",
        json={"action": "verify"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text

    with next(get_session()) as session:
        saved = session.exec(select(Submission).where(Submission.submission_batch_id == batch_id)).all()
        assert len(saved) == 2
        assert {submission.payment_status for submission in saved} == {"paid"}


def test_one_click_batch_pro_creates_single_upgrade_order_and_releases_batch(free_student_token, admin_token):
    batch_id = f"BATCH-E2E-PRO-{os.urandom(4).hex().upper()}"
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
        student.capabilities = {}
        session.add(student)
        for experiment_id in ["exp_pro_batch_a", "exp_pro_batch_b"]:
            if not session.get(Experiment, experiment_id):
                session.add(Experiment(id=experiment_id, title=experiment_id, config_json={}))
        session.commit()

    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pro",
            "is_hungup": True,
            "submission_batch_id": batch_id,
            "client_request_id": f"REQ-E2E-PRO-BATCH-{os.urandom(4).hex()}",
            "experiments": [
                {"experiment_id": "exp_pro_batch_a", "image_paths": ["/uploads/pro-a.jpg"]},
                {"experiment_id": "exp_pro_batch_b", "image_paths": ["/uploads/pro-b.jpg"]},
            ],
        },
        headers={"Authorization": f"Bearer {free_student_token}"},
    )
    assert res.status_code == 200, res.text
    checkout = res.json()
    order = checkout["order"]
    submissions = checkout["submissions"]
    assert order["plan"] == "pro"
    assert order["order_type"] == "plan_upgrade"
    assert order["amount"] == 35.0
    assert order["submission_batch_id"] == batch_id
    assert len([item for item in order["items"] if item["item_type"] == "plan_upgrade"]) == 1
    assert len([item for item in order["items"] if item["item_type"] == "batch_submission"]) == 2
    assert len(submissions) == 2
    assert {submission["status"] for submission in submissions} == {"pending_payment"}

    res = client.post(
        f"/api/v1/orders/{order['id']}/verify",
        json={"action": "verify"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
        assert student.capabilities["plan"] == "pro"
        saved = session.exec(select(Submission).where(Submission.submission_batch_id == batch_id)).all()
        assert len(saved) == 2
        assert {submission.payment_status for submission in saved} == {"paid"}


def test_auto_generated_image_slots_do_not_block_single_slot_auto_prepare(admin_token, monkeypatch):
    queued_submission_ids = []

    def fake_prepare_delay(submission_id, user_id):
        queued_submission_ids.append((submission_id, user_id))

    monkeypatch.setattr(submissions_api.prepare_submission_for_review_task, "delay", fake_prepare_delay, raising=False)

    batch_id = f"BATCH-E2E-AUTOGEN-{os.urandom(4).hex().upper()}"
    image_url = "/uploads/e2e-falling-ball-raw.jpg"
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "target_student": FREE_STUDENT_NO,
            "is_hungup": False,
            "submission_batch_id": batch_id,
            "experiments": [{"experiment_id": "exp_falling_ball_viscosity", "image_paths": [image_url]}],
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()["submissions"][0]
    assert body["status"] == "preparing_review"
    assert body["preprocess_status"] == "queued"
    assert body["image_slots"]["IMG_RAW_DATA"][0]["url"] == image_url
    assert "IMG_L3_CURVE" not in body["image_slots"]
    assert [item[0] for item in queued_submission_ids] == [body["id"]]


def test_checkout_with_complete_image_slots_queues_multi_slot_preprocess(admin_token, monkeypatch):
    queued_submission_ids = []

    def fake_prepare_delay(submission_id, user_id):
        queued_submission_ids.append((submission_id, user_id))

    monkeypatch.setattr(submission_preprocess_service.prepare_submission_for_review_task, "delay", fake_prepare_delay, raising=False)

    batch_id = f"BATCH-E2E-FUSED-{os.urandom(4).hex().upper()}"
    image_slots = {
        "IMG_LC_SIGNED_RAW": [{"url": "/uploads/fused-lc-raw.jpg", "name": "raw.jpg", "sourceIndex": 1}],
        "IMG_LC_FALL_CURVE": [{"url": "/uploads/fused-lc-fall.jpg", "name": "fall.jpg", "sourceIndex": 2}],
        "IMG_LC_RISE_CURVE": [{"url": "/uploads/fused-lc-rise.jpg", "name": "rise.jpg", "sourceIndex": 3}],
    }
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "target_student": FREE_STUDENT_NO,
            "is_hungup": False,
            "submission_batch_id": batch_id,
            "experiments": [{
                "experiment_id": "exp_liquid_crystal_0625",
                "image_paths": [item["url"] for files in image_slots.values() for item in files],
                "image_slots": image_slots,
            }],
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()["submissions"][0]
    assert body["status"] == "preparing_review"
    assert body["preprocess_status"] == "queued"
    assert body["image_slots"]["IMG_LC_SIGNED_RAW"][0]["sourceIndex"] == 1
    assert "IMG_LC_AVG_CURVE" not in body["image_slots"]
    assert [item[0] for item in queued_submission_ids] == [body["id"]]


def test_checkout_unconfirmed_image_assignment_stays_pending(admin_token, monkeypatch):
    queued_submission_ids = []

    def fake_prepare_delay(submission_id, user_id):
        queued_submission_ids.append((submission_id, user_id))

    monkeypatch.setattr(submission_preprocess_service.prepare_submission_for_review_task, "delay", fake_prepare_delay, raising=False)

    batch_id = f"BATCH-E2E-FUSED-UNCONFIRMED-{os.urandom(4).hex().upper()}"
    image_slots = {
        "IMG_LC_SIGNED_RAW": [{"url": "/uploads/fused-lc-raw.jpg", "name": "raw.jpg", "sourceIndex": 1}],
        "IMG_LC_FALL_CURVE": [{"url": "/uploads/fused-lc-fall.jpg", "name": "fall.jpg", "sourceIndex": 2}],
        "IMG_LC_RISE_CURVE": [{"url": "/uploads/fused-lc-rise.jpg", "name": "rise.jpg", "sourceIndex": 3}],
    }
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "target_student": FREE_STUDENT_NO,
            "is_hungup": False,
            "submission_batch_id": batch_id,
            "experiments": [{
                "experiment_id": "exp_liquid_crystal_0625",
                "image_paths": [item["url"] for files in image_slots.values() for item in files],
                "image_slots": image_slots,
                "image_assignment_confirmed": False,
            }],
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()["submissions"][0]
    assert body["status"] == "pending_image_assignment"
    assert body["preprocess_status"] == "waiting_for_image_assignment"
    assert body["image_slots"]["IMG_LC_SIGNED_RAW"][0]["sourceIndex"] == 1
    assert queued_submission_ids == []


def test_batch_image_assignment_and_prepare_review(admin_token, monkeypatch):
    queued_submission_ids = []

    def fake_prepare_delay(submission_id, user_id):
        queued_submission_ids.append((submission_id, user_id))

    monkeypatch.setattr(submissions_api.prepare_submission_for_review_task, "delay", fake_prepare_delay, raising=False)

    batch_id = f"BATCH-E2E-PREPARE-{os.urandom(4).hex().upper()}"
    experiments = [
        {"experiment_id": "exp_meter_modification", "image_paths": ["/uploads/e2e-batch-1.jpg"]},
        {"experiment_id": "exp_sound_velocity", "image_paths": ["/uploads/e2e-batch-2.jpg"]},
    ]
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "target_student": FREE_STUDENT_NO,
            "is_hungup": False,
            "submission_batch_id": batch_id,
            "experiments": experiments,
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    created = res.json()["submissions"]

    assert all(item["status"] == "preparing_review" for item in created)
    assert all(item["preprocess_status"] == "queued" for item in created)
    assert all(item["image_slots"]["IMG_RAW_DATA"][0]["url"] == payload["image_paths"][0] for item, payload in zip(created, experiments))
    assert [item[0] for item in queued_submission_ids] == [item["id"] for item in created]
    queued_submission_ids.clear()

    first_submission_id = created[0]["id"]
    second_submission_id = created[1]["id"]
    with next(get_session()) as session:
        first_submission = session.get(Submission, first_submission_id)
        second_submission = session.get(Submission, second_submission_id)
        first_submission.status = "pending_image_assignment"
        first_submission.preprocess_status = "waiting_for_image_assignment"
        first_submission.image_slots = {}
        second_submission.status = "preparing_review"
        second_submission.preprocess_status = "running"
        session.add(first_submission)
        session.add(second_submission)
        session.commit()

    res = client.get("/api/v1/submissions/review-pool", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    pool_items = [item for item in res.json()["items"] if item["submission_batch_id"] == batch_id]
    assert len(pool_items) >= 2
    assert {item["id"] for item in pool_items}.issuperset({item["id"] for item in created})

    res = client.patch(
        f"/api/v1/submissions/{second_submission_id}/image-slots",
        json={"image_slots": {"IMG_RAW_DATA": [{"url": "/uploads/should-not-overwrite-running.jpg", "name": "raw.jpg"}]}},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    assert res.json()["image_slots"]["IMG_RAW_DATA"][0]["url"] == experiments[1]["image_paths"][0]
    assert res.json()["preprocess_status"] == "running"

    assignments = {
        item["id"]: {"IMG_RAW_DATA": [{"url": f"/uploads/{item['id']}.jpg"}]}
        for item in created
    }
    res = client.post(
        f"/api/v1/submissions/batches/{batch_id}/prepare-review",
        json={"assignments": assignments},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["batch_id"] == batch_id
    assert body["submission_ids"] == [first_submission_id]
    assert body["skipped_already_processing"] == [second_submission_id]
    assert [item[0] for item in queued_submission_ids] == [first_submission_id]

    with next(get_session()) as session:
        submissions = session.exec(select(Submission).where(Submission.submission_batch_id == batch_id)).all()
        by_id = {submission.id: submission for submission in submissions}
        assert (by_id[first_submission_id].status, by_id[first_submission_id].preprocess_status) == ("preparing_review", "queued")
        assert by_id[first_submission_id].image_slots["IMG_RAW_DATA"][0]["url"] == f"/uploads/{first_submission_id}.jpg"
        assert (by_id[second_submission_id].status, by_id[second_submission_id].preprocess_status) == ("preparing_review", "running")
        assert by_id[second_submission_id].image_slots["IMG_RAW_DATA"][0]["url"] == experiments[1]["image_paths"][0]


def test_prepare_review_with_partial_assignments_only_processes_selected_submission(admin_token, monkeypatch):
    queued_submission_ids = []

    def fake_prepare_delay(submission_id, user_id):
        queued_submission_ids.append((submission_id, user_id))

    monkeypatch.setattr(submissions_api.prepare_submission_for_review_task, "delay", fake_prepare_delay, raising=False)

    batch_id = f"BATCH-E2E-PREPARE-PARTIAL-{os.urandom(4).hex().upper()}"
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "target_student": FREE_STUDENT_NO,
            "is_hungup": False,
            "submission_batch_id": batch_id,
            "experiments": [
                {
                    "experiment_id": "exp_meter_modification",
                    "image_paths": ["/uploads/e2e-partial-1.jpg"],
                    "image_assignment_confirmed": False,
                },
                {
                    "experiment_id": "exp_sound_velocity",
                    "image_paths": ["/uploads/e2e-partial-2.jpg"],
                    "image_assignment_confirmed": False,
                },
            ],
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    created = res.json()["submissions"]
    first_submission_id = created[0]["id"]
    second_submission_id = created[1]["id"]
    assert all(item["status"] == "pending_image_assignment" for item in created)

    res = client.post(
        f"/api/v1/submissions/batches/{batch_id}/prepare-review",
        json={"assignments": {
            first_submission_id: {"IMG_RAW_DATA": [{"url": "/uploads/e2e-partial-assigned.jpg"}]},
        }},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["submission_ids"] == [first_submission_id]
    assert body["skipped_missing_images"] == []
    assert [item[0] for item in queued_submission_ids] == [first_submission_id]

    with next(get_session()) as session:
        first_submission = session.get(Submission, first_submission_id)
        second_submission = session.get(Submission, second_submission_id)
        assert (first_submission.status, first_submission.preprocess_status) == ("preparing_review", "queued")
        assert first_submission.image_slots["IMG_RAW_DATA"][0]["url"] == "/uploads/e2e-partial-assigned.jpg"
        assert (second_submission.status, second_submission.preprocess_status) == ("pending_image_assignment", "waiting_for_image_assignment")
        assert second_submission.image_slots == {}


def test_save_correction_syncs_image_slots_to_target_node(admin_token):
    batch_id = f"BATCH-E2E-CORRECTION-{os.urandom(4).hex().upper()}"
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "target_student": FREE_STUDENT_NO,
            "is_hungup": False,
            "submission_batch_id": batch_id,
            "experiments": [{"experiment_id": "exp_meter_modification", "image_paths": ["/uploads/e2e-correction-image.jpg"]}],
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    submission_id = res.json()["submissions"][0]["id"]

    res = client.patch(
        f"/api/v1/submissions/{submission_id}/correction",
        json={
            "corrected_json": {
                "values": {
                    "DBGZ10-0": "83.0",
                },
                "experiment_id": "exp_meter_modification",
                "experiment_name": "电表的改装",
            },
            "image_paths": ["/uploads/e2e-correction-image.jpg"],
            "image_slots": {
                "IMG_RAW_DATA": [
                    {"url": "/uploads/e2e-correction-image.jpg", "name": "raw.jpg"}
                ]
            },
            "save_mode": "draft",
        },
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200, res.text
    corrected = res.json()["corrected_json"]
    assert corrected["values"]["DBGZ10-0"] == "83.0"
    assert corrected["values"]["YSSJDrawingAreaArea"] == "/uploads/e2e-correction-image.jpg"


def test_submission_draft_autosave_does_not_create_submit_history(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_student_flow_data(session, student.id)
        session.commit()

    res = client.post(
        "/api/v1/submissions/self-managed",
        json={"experiment_id": "exp_meter_modification", "image_paths": ["/uploads/e2e-draft.jpg"]},
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    submission = res.json()

    res = client.patch(
        f"/api/v1/submissions/{submission['id']}/draft",
        json={
            "draft_json": {
                "values": {
                    "DBGZ10-0": "83.0",
                },
                "experiment_id": "exp_meter_modification",
                "experiment_name": "电表的改装",
            },
            "image_paths": ["/uploads/e2e-draft.jpg"],
            "image_slots": {
                "IMG_RAW_DATA": [
                    {"url": "/uploads/e2e-draft.jpg", "name": "raw.jpg"}
                ]
            },
            "local_revision": 3,
        },
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["draft_json"]["values"]["DBGZ10-0"] == "83.0"
    assert body["draft_json"]["values"]["YSSJDrawingAreaArea"] == "/uploads/e2e-draft.jpg"
    assert body["local_revision"] == 3

    res = client.get(
        f"/api/v1/submissions/{submission['id']}/draft",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["draft_json"]["values"]["DBGZ10-0"] == "83.0"

    with next(get_session()) as session:
        saved_submission = session.get(Submission, submission["id"])
        assert saved_submission.corrected_json == {}
        versions = session.exec(
            select(SubmissionVersion).where(SubmissionVersion.submission_id == submission["id"])
        ).all()
        assert versions == []


def test_upgrade_plus_flow(free_student_token):
    # 1. Free student upgrades to Plus
    res = client.post(
        "/api/v1/checkout/submit",
        json={"plan": "plus", "is_hungup": True, "experiments": [], "client_request_id": f"REQ-E2E-PLUS-{os.urandom(4).hex()}"},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200, res.text
    order = res.json()["order"]
    assert order["plan"] == "plus"
    assert order["order_type"] == "plan_upgrade"
    assert order["amount"] == 16.0
    assert order["status"] == "pending_payment"
    assert order["experiment_id"] is None # Upgrades set experiment_id to None
    
    # 2. Student decides to buy Pro Plan
    res = client.post(
        "/api/v1/checkout/submit",
        json={"plan": "pro", "is_hungup": True, "experiments": [], "client_request_id": f"REQ-E2E-PRO-{os.urandom(4).hex()}"},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200
    assert res.json()["order"]["amount"] == 35.0


def test_student_plan_capability_matrix(free_student_token, monkeypatch):
    from api.v1 import ai as ai_api

    class FakeTask:
        id = "TASK-PLAN-CAPABILITY"

    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setattr(ai_api.recognize_images_task, "delay", lambda *args, **kwargs: FakeTask())
    monkeypatch.setattr(ai_api.fixed_fill_task, "delay", lambda *args, **kwargs: FakeTask())

    def set_student_plan(plan: str):
        with next(get_session()) as session:
            student = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
            student.capabilities = {"plan": plan}
            session.add(student)
            session.commit()

    def post_compute():
        return client.post(
            "/api/v1/experiments/exp_e2e_flow_unique/compute",
            json={"current_form_values": {}, "submission_id": None},
            headers={"Authorization": f"Bearer {free_student_token}"},
        )

    def post_recognize():
        return client.post(
            "/api/v1/ai/recognize-direct",
            json={
                "experiment_id": "exp_e2e_flow_unique",
                "image_paths": ["/uploads/capability-test.jpg"],
                "submission_id": None,
            },
            headers={"Authorization": f"Bearer {free_student_token}"},
        )

    def post_fixed_fill():
        return client.post(
            "/api/v1/ai/fixed-fill/exp_e2e_flow_unique",
            json={"submission_id": None},
            headers={"Authorization": f"Bearer {free_student_token}"},
        )

    set_student_plan("free")
    assert post_compute().status_code == 403
    assert post_recognize().status_code == 403
    assert post_fixed_fill().status_code == 403

    set_student_plan("plus")
    assert post_compute().status_code == 200
    assert post_recognize().status_code == 200
    assert post_fixed_fill().status_code == 403

    set_student_plan("pro")
    assert post_compute().status_code == 200
    assert post_recognize().status_code == 200
    assert post_fixed_fill().status_code == 200

def test_admin_automation_config(admin_token, student_token, preserve_automation_config):
    # Students must not see automation selectors or Playwright runtime config.
    res = client.get("/api/v1/admin/automation-config", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 403

    res = client.get("/api/v1/admin/automation-config", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    config = res.json()
    assert config["config_json"]["identity"]["passwordPolicy"] == "encrypted_user_password"

    config_json = default_automation_config()
    assert config_json["captcha"]["expectedLength"] == 4
    assert config_json["runtime"]["keepBrowserOpenAfterLogin"] is True
    assert config_json["syncPolicy"]["syncCooldownSeconds"] == 1800
    assert "syncCooldownSeconds" not in config_json["retryPolicy"]
    assert "networkPolicy" not in config_json
    assert config_json["waitPolicy"]["listRefreshTimeoutMs"] == 30000
    config_json["runtime"]["slowMoMs"] = 123
    payload = {
        "name": "default",
        "schema_version": CONFIG_SCHEMA_VERSION,
        "is_active": True,
        "config_json": config_json,
    }
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


def test_school_sync_cooldown_reads_sync_policy_only(preserve_automation_config):
    with next(get_session()) as session:
        config = session.exec(
            select(AutomationEngineConfig).where(AutomationEngineConfig.name == "default")
        ).first()

        if not config:
            config = AutomationEngineConfig(
                name="default",
                config_json=default_automation_config(),
                schema_version=CONFIG_SCHEMA_VERSION,
                is_active=True,
            )
            session.add(config)
            session.commit()
            session.refresh(config)

        config_json = default_automation_config()
        config_json["syncPolicy"]["syncCooldownSeconds"] = 7
        config_json["retryPolicy"]["syncCooldownSeconds"] = 99
        config.config_json = config_json
        config.schema_version = CONFIG_SCHEMA_VERSION
        config.is_active = True
        session.add(config)
        session.commit()

        assert school_sync._sync_cooldown_seconds(session) == 7


def test_captcha_candidate_requires_exact_expected_length():
    assert extract_captcha_candidate("GAA4", 4) == "GAA4"
    assert extract_captcha_candidate("验证码为：GAA4", 4) == "GAA4"
    assert extract_captcha_candidate("GAA", 4) is None
    assert extract_captcha_candidate("GAA45", 4) is None


class FakeLoginErrorLocator:
    def __init__(self, page):
        self.page = page
        self.first = self

    async def count(self):
        return 1

    async def is_visible(self):
        return True

    async def click(self):
        self.page.modal_closed = True


class FakeCaptchaErrorPage:
    url = "http://school.local/Login"

    def __init__(self):
        self.modal_closed = False

    async def evaluate(self, script):
        return ["验证码错误，请重新输入"]

    def locator(self, selector):
        return FakeLoginErrorLocator(self)

    async def wait_for_timeout(self, timeout_ms):
        return None

    async def screenshot(self, path, full_page=True):
        with open(path, "wb") as f:
            f.write(b"fake")

    async def content(self):
        return "<html><body><div class='bootbox-body'>验证码错误，请重新输入</div></body></html>"


def test_login_error_feedback_detects_captcha_before_overview_wait(tmp_path):
    page = FakeCaptchaErrorPage()
    messages = []
    artifacts = {}

    result = asyncio.run(
        check_login_error_feedback(
            page,
            out_dir=tmp_path,
            attempt=1,
            captcha_max_retries=2,
            messages=messages,
            artifacts=artifacts,
        )
    )

    assert result == "captcha_retry"
    assert page.modal_closed is True
    assert messages == ["验证码错误，请重新输入"]
    assert "login_failed_messages_attempt_1" in artifacts


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


def test_admin_ai_config_uses_database_profiles_without_key_leak(admin_token, student_token, preserve_ai_config):
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
        "image_recognition_model": "zai-org/GLM-4.5V",
        "image_recognition_retry_enabled": True,
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
    assert data["image_recognition_model"] == "zai-org/GLM-4.5V"
    assert data["image_recognition_retry_enabled"] is True
    assert data["answer_generation_model"] == "deepseek-ai/DeepSeek-V4-Flash"
    assert data["captcha_model"] == "zai-org/GLM-4.5V"
    assert "api_key" not in data


def test_admin_ai_task_overrides_store_image_auto_match_secret(admin_token, student_token, preserve_ai_config):
    payload = {
        "task_overrides_json": {
            "experiment_image_auto_match": {
                "enabled": True,
                "provider": "openai_compatible",
                "base_url": "http://localhost:59663/v1",
                "chat_completions_url": "http://localhost:59663/v1/chat/completions",
                "api_key": "json-secret-key",
                "model": "gpt-5.5",
                "temperature": 0,
                "timeout_seconds": 120,
                "batch_size": 1,
                "concurrency": 3,
                "max_retries": 2,
                "retry_delay_seconds": 30,
            }
        }
    }

    res = client.put(
        "/api/v1/ai/admin/task-overrides",
        json=payload,
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 403

    res = client.put(
        "/api/v1/ai/admin/task-overrides",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    task_config = data["task_overrides_json"]["experiment_image_auto_match"]
    assert task_config["api_key"] == "json-secret-key"
    assert task_config["model"] == "gpt-5.5"

    res = client.get("/api/v1/ai/admin/config", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    task_config = res.json()["task_overrides_json"]["experiment_image_auto_match"]
    assert task_config["api_key"] == "json-secret-key"


def test_image_auto_match_provider_uses_task_override_json(preserve_ai_config):
    from services.ai_provider import AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH, ensure_ai_config, get_ai_provider

    with next(get_session()) as session:
        config = ensure_ai_config(session)
        config.task_overrides_json = {
            "experiment_image_auto_match": {
                "enabled": True,
                "provider": "openai_compatible",
                "base_url": "http://localhost:59663/v1",
                "chat_completions_url": "http://localhost:59663/v1/chat/completions",
                "api_key": "json-secret-key",
                "model": "gpt-5.5",
                "temperature": 0,
                "timeout_seconds": 120,
                "batch_size": 1,
                "concurrency": 3,
            }
        }
        session.add(config)
        session.commit()

        profile = get_ai_provider(session).get_profile(AI_TASK_EXPERIMENT_IMAGE_AUTO_MATCH)

    assert profile.api_key == "json-secret-key"
    assert profile.base_url == "http://localhost:59663/v1"
    assert profile.model == "gpt-5.5"
    assert profile.timeout_seconds == 120
    assert profile.max_images_per_task == 1
    assert profile.concurrency == 3


def test_repeated_image_recognition_uses_retry_task_override(preserve_ai_config):
    from services.ai_provider import AI_TASK_IMAGE_RECOGNITION, ensure_ai_config, get_ai_provider

    with next(get_session()) as session:
        config = ensure_ai_config(session)
        config.image_recognition_model = "primary-vl"
        config.image_recognition_retry_enabled = True
        config.task_overrides_json = {
            "image_recognition_retry": {
                "enabled": True,
                "provider": "openai_compatible",
                "base_url": "http://localhost:59663/v1",
                "chat_completions_url": "http://localhost:59663/v1/chat/completions",
                "api_key": "retry-json-secret-key",
                "model": "retry-vl",
                "temperature": 0,
                "timeout_seconds": 120,
                "batch_size": 5,
                "concurrency": 3,
            }
        }
        session.add(config)
        session.commit()

        first_profile = get_ai_provider(session).get_profile(AI_TASK_IMAGE_RECOGNITION, recognition_attempt=1)
        retry_profile = get_ai_provider(session).get_profile(AI_TASK_IMAGE_RECOGNITION, recognition_attempt=2)

    assert first_profile.model == "primary-vl"
    assert retry_profile.api_key == "retry-json-secret-key"
    assert retry_profile.base_url == "http://localhost:59663/v1"
    assert retry_profile.model == "retry-vl"
    assert retry_profile.timeout_seconds == 120
    assert retry_profile.max_images_per_task == 5
    assert retry_profile.concurrency == 3


def test_repeated_image_recognition_response_reports_retry_task_override(admin_token, monkeypatch, preserve_ai_config):
    from api.v1 import ai as ai_api
    from services.ai_provider import ensure_ai_config

    captured = {}

    class FakeTask:
        id = "TASK-AI-RETRY-2"

    def fake_delay(*args, **kwargs):
        captured["args"] = args
        captured["kwargs"] = kwargs
        return FakeTask()

    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setattr(ai_api.recognize_images_task, "delay", fake_delay)

    with next(get_session()) as session:
        admin = session.exec(select(User).where(User.username == "admin_e2e_flow")).first()
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        admin_id = admin.id
        config = ensure_ai_config(session)
        config.image_recognition_model = "primary-vl"
        config.image_recognition_retry_enabled = True
        config.task_overrides_json = {
            "image_recognition_retry": {
                "enabled": True,
                "provider": "openai_compatible",
                "base_url": "http://localhost:59663/v1",
                "chat_completions_url": "http://localhost:59663/v1/chat/completions",
                "api_key": "retry-json-secret-key",
                "model": "retry-vl",
                "temperature": 0,
                "timeout_seconds": 120,
                "batch_size": 5,
                "concurrency": 3,
            }
        }
        session.add(config)
        submission = Submission(
            id="SUB-AI-RETRY-MODEL",
            student_id=student.id,
            experiment_id="exp_e2e_flow_unique",
            status="reviewing",
            payment_status="paid",
            is_one_click_handoff=True,
            image_paths=["/uploads/test-ai.jpg"],
        )
        session.merge(submission)
        session.exec(delete(AiTaskRun).where(AiTaskRun.target_id == submission.id))
        session.exec(delete(AuditLog).where(AuditLog.target_id == submission.id))
        session.add(AiTaskRun(
            task_id="TASK-AI-RETRY-OLD",
            task_kind="image_recognition",
            status="succeeded",
            user_id=admin_id,
            target_id=submission.id,
            experiment_id=submission.experiment_id,
            submission_id=submission.id,
        ))
        session.commit()

    res = client.post(
        "/api/v1/ai/recognize-direct",
        json={
            "experiment_id": "exp_e2e_flow_unique",
            "submission_id": "SUB-AI-RETRY-MODEL",
            "image_paths": ["/uploads/test-ai.jpg"],
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["recognition_attempt"] == 2
    assert body["model"] == "retry-vl"
    assert captured["args"] == (
        "exp_e2e_flow_unique",
        ["/uploads/test-ai.jpg"],
        admin_id,
        "SUB-AI-RETRY-MODEL",
        2,
    )

    with next(get_session()) as session:
        run = session.get(AiTaskRun, "TASK-AI-RETRY-2")
        assert run.request_payload["recognition_attempt"] == 2
        assert run.request_payload["model"] == "retry-vl"


def test_ai_assist_task_start_logs_submission_target(admin_token, student_token, monkeypatch):
    from api.v1 import ai as ai_api

    class FakeTask:
        id = "TASK-AI-START-1"

    monkeypatch.setenv("AI_API_KEY", "test-key")
    monkeypatch.setattr(ai_api.recognize_images_task, "delay", lambda *args, **kwargs: FakeTask())

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        submission = Submission(
            id="SUB-AI-AUDIT-START",
            student_id=student.id,
            experiment_id="exp_e2e_flow_unique",
            status="reviewing",
            payment_status="paid",
            is_one_click_handoff=True,
            image_paths=["/uploads/test-ai.jpg"],
        )
        session.merge(submission)
        session.exec(delete(AiTaskRun).where(AiTaskRun.target_id == submission.id))
        session.exec(delete(AuditLog).where(AuditLog.target_id == submission.id))
        session.commit()

    res = client.post(
        "/api/v1/ai/recognize-direct",
        json={
            "experiment_id": "exp_e2e_flow_unique",
            "submission_id": "SUB-AI-AUDIT-START",
            "image_paths": ["/uploads/test-ai.jpg"],
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["task_id"] == "TASK-AI-START-1"
    assert body["audit_target_id"] == "SUB-AI-AUDIT-START"
    assert body["poll_timeout_seconds"] >= 180

    with next(get_session()) as session:
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "SUB-AI-AUDIT-START")
            .where(AuditLog.action == "ai_recognition_started")
        ).first()
        assert log is not None
        assert log.status == "pending"
        assert "TASK-AI-START-1" in log.details
        run = session.get(AiTaskRun, "TASK-AI-START-1")
        assert run is not None
        assert run.task_kind == "image_recognition"
        assert run.status == "pending"
        assert run.target_id == "SUB-AI-AUDIT-START"
        assert run.started_audit_log_id == log.id

    res = client.get("/api/v1/audit/my_logs", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200, res.text
    actions = [item["action"] for item in res.json()]
    assert "ai_recognition_started" in actions


def test_ai_assist_worker_completion_logs_canonical_action(monkeypatch):
    from worker import ai_tasks
    from services.ai_task_audit import start_ai_task_run

    async def fake_recognize_images(
        _experiment_id,
        _image_paths,
        _session,
        recognition_attempt=1,
        recognition_node_ids=None,
        recognition_extra_prompt=None,
    ):
        return {"A1": "42"}

    monkeypatch.setattr(ai_tasks.ai_service, "recognize_images", fake_recognize_images)

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AiTaskRun).where(AiTaskRun.target_id == "SUB-AI-AUDIT-DONE"))
        session.exec(delete(AuditLog).where(AuditLog.target_id == "SUB-AI-AUDIT-DONE"))
        start_ai_task_run(
            session,
            task_id="TASK-AI-WORKER-DONE",
            user_id=student.id,
            task_kind="image_recognition",
            target_id="SUB-AI-AUDIT-DONE",
            experiment_id="exp_e2e_flow_unique",
            submission_id="SUB-AI-AUDIT-DONE",
            details={"experiment_id": "exp_e2e_flow_unique"},
        )
        session.commit()
        student_id = student.id

    result = ai_tasks.recognize_images_task.apply(
        args=("exp_e2e_flow_unique", ["/uploads/test-ai.jpg"], student_id, "SUB-AI-AUDIT-DONE"),
        task_id="TASK-AI-WORKER-DONE",
    ).get()
    assert result == {"A1": "42"}

    with next(get_session()) as session:
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "SUB-AI-AUDIT-DONE")
            .where(AuditLog.action == "ai_recognition_completed")
        ).first()
        assert log is not None
        assert log.status == "success"
        assert "recognized_count" in log.details
        started = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "SUB-AI-AUDIT-DONE")
            .where(AuditLog.action == "ai_recognition_started")
        ).first()
        run = session.get(AiTaskRun, "TASK-AI-WORKER-DONE")
        assert started.status == "success"
        assert run.status == "succeeded"
        assert run.finished_audit_log_id == log.id


def test_ai_task_status_treats_started_as_pending(admin_token, monkeypatch):
    from api.v1 import ai as ai_api

    class StartedTask:
        state = "STARTED"
        result = None
        info = None

    monkeypatch.setattr(ai_api.celery_app, "AsyncResult", lambda _task_id: StartedTask())

    res = client.get("/api/v1/ai/task/TASK-STARTED", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200, res.text
    assert res.json() == {"status": "pending", "state": "STARTED"}


def test_student_cannot_poll_other_users_ai_task(student_token, free_student_token, monkeypatch):
    from api.v1 import ai as ai_api

    class PendingTask:
        state = "PENDING"
        result = None
        info = None

    monkeypatch.setattr(ai_api.celery_app, "AsyncResult", lambda _task_id: PendingTask())

    with next(get_session()) as session:
        owner = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.merge(AiTaskRun(
            task_id="TASK-STUDENT-OWNER-ONLY",
            task_kind="image_recognition",
            status="pending",
            user_id=owner.id,
            target_id="exp_e2e_flow_unique",
            experiment_id="exp_e2e_flow_unique",
        ))
        session.commit()

    res = client.get("/api/v1/ai/task/TASK-STUDENT-OWNER-ONLY", headers={"Authorization": f"Bearer {free_student_token}"})
    assert res.status_code == 403, res.text

    res = client.get("/api/v1/ai/task/TASK-STUDENT-OWNER-ONLY", headers={"Authorization": f"Bearer {student_token}"})
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "pending"


def test_ai_task_failure_signal_reconciles_pre_run_failure_audit():
    from worker import ai_tasks
    from services.ai_task_audit import start_ai_task_run

    with next(get_session()) as session:
        admin = session.exec(select(User).where(User.role == "admin")).first()
        session.exec(delete(AiTaskRun).where(AiTaskRun.target_id == "SUB-AI-AUDIT-FAIL"))
        session.exec(delete(AuditLog).where(AuditLog.target_id == "SUB-AI-AUDIT-FAIL"))
        start_ai_task_run(
            session,
            task_id="TASK-PRE-RUN-FAIL",
            user_id=admin.id,
            task_kind="image_recognition",
            target_id="SUB-AI-AUDIT-FAIL",
            experiment_id="exp_e2e_flow_unique",
            submission_id="SUB-AI-AUDIT-FAIL",
            details={"experiment_id": "exp_e2e_flow_unique"},
        )
        session.commit()

    ai_tasks.record_ai_task_failure(
        task_id="TASK-PRE-RUN-FAIL",
        exception=TypeError("recognize_images_task() takes 4 positional arguments but 5 were given"),
    )

    with next(get_session()) as session:
        started = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "SUB-AI-AUDIT-FAIL")
            .where(AuditLog.action == "ai_recognition_started")
        ).first()
        failed = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "SUB-AI-AUDIT-FAIL")
            .where(AuditLog.action == "ai_recognition_failed")
        ).first()
        assert started is not None
        assert started.status == "failed"
        assert failed is not None
        assert failed.status == "failed"
        assert "TASK-PRE-RUN-FAIL" in failed.details
        assert "celery_task_failure_signal" in failed.details
        run = session.get(AiTaskRun, "TASK-PRE-RUN-FAIL")
        assert run.status == "failed"
        assert run.finished_audit_log_id == failed.id


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


def test_polling_marks_school_opening_failed_when_bootbox_visible(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_user_audit_logs(session, student.id)
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        job = AutomationJob(
            id="JOB-BOOTBOX-POLL",
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
        job_id="JOB-BOOTBOX-POLL",
        playwright=object(),
        browser=object(),
        context=object(),
        page=FakeBootboxPage("error"),
        source="overview_login",
    )

    res = client.get(
        "/api/v1/automation-jobs/JOB-BOOTBOX-POLL",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["status"] == "failed"
    assert data["messageCode"] == "school.detail.failed"
    assert data["messageParams"]["reason"] == "学校系统弹窗提示：error"

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-BOOTBOX-POLL")
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "JOB-BOOTBOX-POLL")
            .where(AuditLog.action == "school_detail_sync_failed")
        ).first()
        assert job.error_code == "SCHOOL_BOOTBOX_ERROR"
        assert job.result_payload["currentStep"] == "school.detail.opening"
        assert job.result_payload["bootbox"]["bodyText"] == "error"
        assert job.result_payload["sessionReset"]["closed"] is True
        assert log is not None

    assert school_session_manager.get(student_id) is None


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
        delete_user_audit_logs(session, student.id)
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


def test_school_overview_latest_merges_list_confirmed_submit_snapshot(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(Submission).where(Submission.id == "SUB-OVERVIEW-MERGE"))
        now = get_utc_now()
        submission = Submission(
            id="SUB-OVERVIEW-MERGE",
            student_id=student.id,
            experiment_id="exp_e2e_flow_unique",
            status="draft_submitted",
            payment_status="not_required",
            corrected_json={"experiment_name": "Test Exp E2E", "values": {}},
        )
        session.add(submission)
        session.flush()
        session.add(
            SchoolSyncSnapshot(
                user_id=student.id,
                snapshot_json={
                    "source": "school_complete_report_list",
                    "experiments": [
                        {
                            "experimentName": "Test Exp E2E",
                            "originalStatusText": "未提交",
                            "schoolStatus": "school_not_submitted",
                        }
                    ],
                },
                summary_json={
                    "source": "school_complete_report_list",
                    "total": 1,
                    "completed": 0,
                    "unsubmitted": 1,
                    "draftSubmitted": 0,
                    "finalSubmitted": 0,
                    "unknown": 0,
                },
                synced_at=now,
            )
        )
        session.add(
            SchoolSyncSnapshot(
                user_id=student.id,
                submission_id=submission.id,
                experiment_id=submission.experiment_id,
                snapshot_json={
                    "source": "school_submit_confirmed",
                    "status": {
                        "experimentName": "Test Exp E2E",
                        "originalStatusText": "临时提交",
                        "schoolStatus": "school_draft_submitted",
                    },
                },
                summary_json={
                    "source": "school_submit_confirmed",
                    "mode": "draft",
                    "submitAccepted": True,
                    "statusConfirmation": "list_confirmed",
                    "experimentName": "Test Exp E2E",
                    "originalStatusText": "临时提交",
                    "schoolStatus": "school_draft_submitted",
                },
                synced_at=now,
            )
        )
        session.commit()

    res = client.get(
        "/api/v1/school-sync/overview/latest",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    latest = res.json()
    assert latest["experiments"][0]["experimentName"] == "Test Exp E2E"
    assert latest["experiments"][0]["schoolStatus"] == "school_draft_submitted"
    assert latest["experiments"][0]["schoolStatusSource"] == "school_submit_confirmed"
    assert latest["experiments"][0]["statusConfirmation"] == "list_confirmed"
    assert latest["summary"]["completed"] == 1
    assert latest["summary"]["unsubmitted"] == 0
    assert latest["summary"]["draftSubmitted"] == 1


def test_admin_student_list_summary_merges_confirmed_school_submit_snapshots(admin_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        now = get_utc_now()
        session.add(
            SchoolSyncSnapshot(
                user_id=student.id,
                snapshot_json={
                    "source": "school_complete_report_list",
                    "experiments": [
                        {
                            "experimentId": "exp_e2e_flow_unique",
                            "experimentName": "Test Exp E2E",
                            "originalStatusText": "未提交",
                            "schoolStatus": "school_not_submitted",
                        },
                        {
                            "experimentId": "exp_meter_modification",
                            "experimentName": "电表的改装",
                            "originalStatusText": "未提交",
                            "schoolStatus": "school_not_submitted",
                        },
                    ],
                },
                summary_json={
                    "source": "school_complete_report_list",
                    "total": 2,
                    "completed": 0,
                    "unsubmitted": 2,
                    "draftSubmitted": 0,
                    "finalSubmitted": 0,
                    "unknown": 0,
                },
                synced_at=now,
            )
        )
        for experiment_id, experiment_name, mode, school_status, original_text in [
            ("exp_e2e_flow_unique", "Test Exp E2E", "final", "school_final_submitted", "正常提交"),
            ("exp_meter_modification", "电表的改装", "draft", "school_draft_submitted", "临时提交"),
        ]:
            submission_id = f"SUB-CONFIRMED-{experiment_id}"
            session.add(
                Submission(
                    id=submission_id,
                    student_id=student.id,
                    experiment_id=experiment_id,
                    status="completed" if mode == "final" else "draft_submitted",
                    payment_status="not_required",
                    corrected_json={"experiment_name": experiment_name, "values": {}},
                )
            )
            session.flush()
            session.add(
                SchoolSyncSnapshot(
                    user_id=student.id,
                    submission_id=submission_id,
                    experiment_id=experiment_id,
                    snapshot_json={
                        "source": "school_submit_confirmed",
                        "status": {
                            "experimentName": experiment_name,
                            "originalStatusText": original_text,
                            "schoolStatus": school_status,
                        },
                    },
                    summary_json={
                        "source": "school_submit_confirmed",
                        "mode": mode,
                        "submitAccepted": True,
                        "statusConfirmation": "list_confirmed",
                        "experimentName": experiment_name,
                        "originalStatusText": original_text,
                        "schoolStatus": school_status,
                    },
                    synced_at=now,
                )
            )
        session.commit()

    res = client.get(
        "/api/v1/admin/students",
        params={"query": STUDENT_NO},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    item = next(row for row in res.json()["items"] if row["studentNo"] == STUDENT_NO)
    assert item["summary"]["finalSubmittedCount"] == 1
    assert item["summary"]["draftSubmittedCount"] == 1


def test_school_overview_sync_blocks_parallel_jobs(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_user_audit_logs(session, student.id)
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


def test_admin_can_start_final_submit_drafts_job(admin_token, student_token, monkeypatch):
    executed = []

    def fake_final_submit_drafts(job_id, user_id):
        executed.append((job_id, user_id))
        with next(get_session()) as session:
            job = session.get(AutomationJob, job_id)
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.finalSubmitDrafts.success"
            job.public_message_params = {"count": 1}
            session.add(job)
            session.commit()

    monkeypatch.setattr("api.v1.admin_students.run_admin_final_submit_drafts", fake_final_submit_drafts)

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        student_id = student.id
        session.commit()

    forbidden = client.post(
        f"/api/v1/admin/students/{student_id}/final-submit-drafts",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert forbidden.status_code == 403, forbidden.text

    res = client.post(
        f"/api/v1/admin/students/{student_id}/final-submit-drafts",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["action"] == "admin_final_submit_drafts"
    assert executed and executed[0][1] == student_id


def test_student_completion_and_submission_screenshot_jobs_are_self_scoped(student_token, admin_token, monkeypatch):
    def fake_completion_check(job_id, user_id, experiment_ids=None):
        with next(get_session()) as session:
            user = session.get(User, user_id)
            job = session.get(AutomationJob, job_id)
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.completion.success"
            job.result_payload = {
                "completionCheck": {
                    "studentId": user_id,
                    "studentNo": user.student_no,
                    "realName": user.real_name,
                    "summary": {
                        "experimentCount": 1,
                        "checkedExperimentCount": 1,
                        "completeExperimentCount": 1,
                        "incompleteExperimentCount": 0,
                        "skippedExperimentCount": 0,
                        "errorExperimentCount": 0,
                        "missingCount": 0,
                    },
                    "experiments": [
                        {
                            "experimentId": (experiment_ids or ["exp_e2e_flow_unique"])[0],
                            "experimentName": "Test Exp E2E",
                            "schoolStatus": "school_draft_submitted",
                            "originalStatusText": "临时提交",
                            "checkStatus": "checked",
                            "complete": True,
                            "missing": [],
                        }
                    ],
                }
            }
            job.finished_at = get_utc_now()
            job.updated_at = get_utc_now()
            session.add(job)
            session.commit()

    def fake_submission_screenshots(job_id, user_id, experiment_ids=None):
        with next(get_session()) as session:
            user = session.get(User, user_id)
            job = session.get(AutomationJob, job_id)
            job.status = "succeeded"
            job.public_status = "succeeded"
            job.public_message_code = "school.submissionScreenshots.success"
            job.result_payload = {
                "submissionScreenshots": {
                    "studentId": user_id,
                    "studentNo": user.student_no,
                    "realName": user.real_name,
                    "summary": {
                        "experimentCount": 1,
                        "capturedExperimentCount": 0,
                        "skippedExperimentCount": 1,
                        "errorExperimentCount": 0,
                    },
                    "experiments": [
                        {
                            "experimentId": "exp_e2e_flow_unique",
                            "experimentName": "Test Exp E2E",
                            "schoolStatus": "school_not_submitted",
                            "originalStatusText": "未提交",
                            "captureStatus": "skipped",
                            "screenshotAvailable": False,
                            "reason": "学校状态未临时提交或正式提交，跳过截图",
                        }
                    ],
                }
            }
            job.finished_at = get_utc_now()
            job.updated_at = get_utc_now()
            session.add(job)
            session.commit()

    monkeypatch.setattr(school_sync, "run_school_completion_check", fake_completion_check)
    monkeypatch.setattr(school_sync, "run_school_submission_screenshots", fake_submission_screenshots)

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        session.commit()

    res = client.post(
        "/api/v1/school-sync/experiments/exp_e2e_flow_unique/completion-check",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    completion_job = res.json()
    assert completion_job["action"] == "school_completion_check"
    assert completion_job["experimentId"] == "exp_e2e_flow_unique"

    res = client.get(
        f"/api/v1/school-sync/completion-check/{completion_job['jobId']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    completion = res.json()
    assert completion["studentNo"] == STUDENT_NO
    assert completion["experiments"][0]["experimentId"] == "exp_e2e_flow_unique"

    res = client.post(
        "/api/v1/school-sync/submission-screenshots",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    screenshot_job = res.json()
    assert screenshot_job["action"] == "school_submission_screenshots"

    res = client.get(
        f"/api/v1/school-sync/submission-screenshots/{screenshot_job['jobId']}",
        headers={"Authorization": f"Bearer {student_token}"},
    )
    assert res.status_code == 200, res.text
    screenshots = res.json()
    assert screenshots["studentNo"] == STUDENT_NO
    assert screenshots["summary"]["skippedExperimentCount"] == 1

    admin_completion = client.post(
        "/api/v1/school-sync/completion-check",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_completion.status_code == 403

    admin_screenshots = client.post(
        "/api/v1/school-sync/submission-screenshots",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert admin_screenshots.status_code == 403


def test_school_overview_failure_audit_contains_diagnostic_payload(student_token):
    config_json = default_automation_config()
    config_json["schoolSystem"]["baseUrl"] = "http://10.25.77.60:8001"
    config_json["schoolSystem"]["loginUrl"] = "http://10.25.77.60:8001/Login"

    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_user_audit_logs(session, student.id)
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
        assert "networkPolicy" not in details["config"]
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
        delete_user_audit_logs(session, student.id)
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


def test_reviewer_school_detail_sync_uses_submission_student(admin_token, monkeypatch):
    captured = {}

    def fake_detail_sync(job_id, user_id, experiment_id):
        captured["job_id"] = job_id
        captured["user_id"] = user_id
        captured["experiment_id"] = experiment_id

    monkeypatch.setattr(school_sync, "run_school_detail_sync", fake_detail_sync)

    experiment_id = "exp_e2e_flow_unique"
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
        admin = session.exec(select(User).where(User.username == "admin_e2e_flow")).first()
        submission = Submission(
            id=f"SUB-SYNC-{os.urandom(4).hex().upper()}",
            student_id=student.id,
            experiment_id=experiment_id,
            status="reviewing",
            payment_status="paid",
            is_one_click_handoff=True,
            image_paths=["/uploads/sync-review.jpg"],
        )
        session.add(submission)
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        session.commit()
        submission_id = submission.id
        student_id = student.id
        admin_id = admin.id

    res = client.post(
        f"/api/v1/school-sync/experiments/{experiment_id}/submissions/{submission_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    job = res.json()
    assert job["action"] == "school_detail_sync"
    assert job["submissionId"] == submission_id
    assert captured["user_id"] == student_id
    assert captured["experiment_id"] == experiment_id

    with next(get_session()) as session:
        db_job = session.get(AutomationJob, job["jobId"])
        assert db_job.actor_user_id == student_id
        assert db_job.request_payload["requested_by"] == admin_id


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
        delete_user_audit_logs(session, student.id)
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        delete_student_flow_data(session, student.id)
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
        delete_user_audit_logs(session, student.id)
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        delete_student_flow_data(session, student.id)
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
        delete_user_audit_logs(session, student.id)
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        delete_student_flow_data(session, student.id)
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
        delete_user_audit_logs(session, student.id)
        session.exec(delete(SchoolSyncSnapshot).where(SchoolSyncSnapshot.user_id == student.id))
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        delete_student_flow_data(session, student.id)
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
        delete_user_audit_logs(session, student.id)
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
            .where(AuditLog.target_id == "SUB-STRUCTURED-FAIL")
            .where(AuditLog.action == "school_draft_submit_failed")
        ).first()
        assert job.result_payload["feedback"] == ["实验问题未填写完整，提交失败"]
        assert job.result_payload["fieldWriteReport"]["missingFields"][0]["nodeId"] == "YSSJDrawingAreaArea"
        details = json.loads(log.details)
        assert details["errorCode"] == "SUBMIT_REJECTED_BY_SCHOOL"
        assert details["feedback"] == ["实验问题未填写完整，提交失败"]
        assert details["fieldWriteSummary"]["missingCount"] == 1
        assert details["artifacts"]["before_submit_modal_html"] == "/tmp/before.html"


def test_school_detail_failure_audit_uses_detail_job_target(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_user_audit_logs(session, student.id)
        session.exec(delete(AutomationJob).where(AutomationJob.actor_user_id == student.id))
        job = AutomationJob(
            id="JOB-DETAIL-BOOTBOX-FAIL",
            actor_user_id=student.id,
            action="school_detail_sync",
            status="running",
            public_status="running",
            public_message_code="school.detail.opening",
            experiment_id="exp_meter_modification",
        )
        session.add(job)
        session.commit()

        error = SchoolAutomationError(
            "SCHOOL_BOOTBOX_ERROR",
            "学校系统弹窗提示：error",
            current_step="school.detail.opening",
            message=json.dumps(
                {
                    "phase": "after_open_report_click",
                    "bootbox": {"bodyText": "error"},
                    "artifacts": {"after_open_report_click_bootbox_html": "/tmp/bootbox.html"},
                },
                ensure_ascii=False,
            ),
        )
        school_report_sync_service._mark_job_failed(session, job, error)
        session.commit()

    with next(get_session()) as session:
        job = session.get(AutomationJob, "JOB-DETAIL-BOOTBOX-FAIL")
        log = session.exec(
            select(AuditLog)
            .where(AuditLog.target_id == "JOB-DETAIL-BOOTBOX-FAIL")
            .where(AuditLog.action == "school_detail_sync_failed")
        ).first()
        assert job.status == "failed"
        assert job.public_message_code == "school.detail.failed"
        assert job.result_payload["bootbox"]["bodyText"] == "error"
        details = json.loads(log.details)
        assert details["errorCode"] == "SCHOOL_BOOTBOX_ERROR"
        assert details["artifacts"]["after_open_report_click_bootbox_html"] == "/tmp/bootbox.html"


def test_student_audit_logs_hide_internal_actions(student_token):
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == STUDENT_NO)).first()
        delete_user_audit_logs(session, student.id)
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
    with next(get_session()) as session:
        student = session.exec(select(User).where(User.student_no == FREE_STUDENT_NO)).first()
        student.capabilities = {}
        session.add(student)
        session.commit()

    # 1. Free student tries to submit WITHOUT hungup, should be 403 Forbidden!
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "is_hungup": False,
            "experiments": [{"experiment_id": "exp_e2e_flow_unique", "image_paths": ["/uploads/free-blocked.jpg"]}],
        },
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 403, "Student should be blocked from submitting without paying!"
    
    # 2. Student decides to buy Pro Plan
    res = client.post(
        "/api/v1/checkout/submit",
        json={"plan": "pro", "is_hungup": True, "experiments": [], "client_request_id": f"REQ-E2E-FREE-PRO-{os.urandom(4).hex()}"},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200
    pro_order_id = res.json()["order"]["id"]
    
    # 3. Admin verifies the Pro Plan order, upgrading the student
    res = client.post(
        f"/api/v1/orders/{pro_order_id}/verify",
        json={"action": "verify"},
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert res.status_code == 200

    upload_res = client.post(
        "/api/v1/files/upload",
        files={"file": ("pro_submit.png", TINY_PNG_BYTES, "image/png")},
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert upload_res.status_code == 200
    image_url = upload_res.json()["url"]

    # 4. Student submits again, this time they are Pro, should bypass payment!
    res = client.post(
        "/api/v1/checkout/submit",
        json={
            "plan": "pay_per_use",
            "is_hungup": False,
            "experiments": [{"experiment_id": "exp_e2e_flow_unique", "image_paths": [image_url]}],
        },
        headers={"Authorization": f"Bearer {free_student_token}"}
    )
    assert res.status_code == 200, "Pro user should be allowed to submit without hungup!"
    submission = res.json()["submissions"][0]
    
    # 5. Verify it's immediately in the review pool
    res = client.get("/api/v1/submissions/review-pool", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    review_pool = res.json()["items"]
    sub_found = next((s for s in review_pool if s["id"] == submission["id"]), None)
    assert sub_found is not None
    assert sub_found["status"] == "pending_image_assignment"
