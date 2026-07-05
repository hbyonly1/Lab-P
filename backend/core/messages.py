from typing import Any, Dict, Optional


AUTOMATION_MESSAGES: Dict[str, str] = {
    "school.overview.syncing": "正在从学校系统同步您的概览数据，请耐心等待...",
    "school.overview.connecting": "正在准备学校系统会话...",
    "school.overview.openingLogin": "正在准备学校系统会话...",
    "school.overview.recognizingCaptcha": "正在识别登录验证码...",
    "school.overview.loggingIn": "正在确认学校系统登录结果...",
    "school.overview.checkingLogin": "正在确认学校系统登录结果...",
    "school.overview.retryingCaptcha": "验证码校验失败，正在重新识别并重试...",
    "school.overview.readingList": "正在读取完成报告列表...",
    "school.overview.savingSnapshot": "正在加载学校系统状态到平台...",
    "school.overview.success": "您的概览数据已读取完成，请查看仪表盘进行下一步操作。",
    "school.overview.failed": "当前无法连接至学校系统，原因：{reason}，若该情况持续存在，请反馈并联系管理员。",
    "school.detail.syncing": "正在从学校系统同步您的「{experimentName}」填写数据，请耐心等待...",
    "school.detail.connecting": "正在准备学校系统会话...",
    "school.detail.opening": "正在打开实验报告...",
    "school.detail.reading": "正在读取学校系统已填写内容...",
    "school.detail.savingSnapshot": "正在加载实验填写快照到平台...",
    "school.detail.success": "您的实验数据填写已读取完成，并已回填至当前网页，请进行下一步操作。",
    "school.detail.failed": "当前无法同步实验数据，原因：{reason}，若该情况持续存在，请反馈并联系管理员。",
    "school.submit.saving": "正在保存数据至平台...",
    "school.submit.connecting": "正在准备学校系统会话...",
    "school.submit.opening": "正在打开实验报告...",
    "school.submit.filling": "正在回填表单数据...",
    "school.submit.verifying": "正在校验写入结果...",
    "school.submit.submittingDraft": "正在执行临时提交...",
    "school.submit.submittingFinal": "正在执行正式提交...",
    "school.submit.confirming": "正在确认学校系统反馈...",
    "school.submit.returningList": "正在同步学校提交状态...",
    "school.submit.readingStatus": "正在同步学校提交状态...",
    "school.submit.success": "提交成功，学校系统状态已更新。",
    "school.submit.failed": "提交失败，原因：{reason}，系统已保留本次平台数据快照。",
    "school.submit.verifyFailed": "部分内容未能成功写入学校系统，系统已停止提交。请稍后重试；若持续失败，请反馈并联系管理员。",
}


ERROR_MESSAGE_CODES: Dict[str, str] = {
    "CONFIG_INVALID": "school.overview.failed",
    "NETWORK_UNREACHABLE": "school.overview.failed",
    "CAPTCHA_RETRY_EXHAUSTED": "school.overview.failed",
    "CREDENTIAL_FAILED": "school.overview.failed",
    "LOGIN_TIMEOUT": "school.overview.failed",
    "SELECTOR_MISSING": "school.overview.failed",
    "UNKNOWN_LOGIN_RESULT": "school.overview.failed",
    "REPORT_MODAL_NOT_FOUND": "school.detail.failed",
    "FIELD_WRITE_VERIFY_FAILED": "school.submit.verifyFailed",
    "SCHOOL_SESSION_UNAVAILABLE": "school.submit.failed",
    "REPORT_ROW_NOT_FOUND": "school.detail.failed",
    "REPORT_OPEN_BUTTON_MISSING": "school.detail.failed",
    "DRAFT_SUBMIT_BUTTON_MISSING": "school.submit.failed",
    "SUBMIT_REJECTED_BY_SCHOOL": "school.submit.failed",
    "SUBMIT_FEEDBACK_TIMEOUT": "school.submit.failed",
    "SCHOOL_STATUS_NOT_CONFIRMED": "school.submit.failed",
    "FINAL_SUBMIT_DISABLED": "school.submit.failed",
    "SCHOOL_BROWSER_CLOSED": "school.submit.failed",
    "JOB_CANCELLED": "school.submit.failed",
    "JOB_ALREADY_RUNNING": "school.submit.failed",
    "IDEMPOTENCY_CONFLICT": "school.submit.failed",
}


def message_code_for_error(error_code: Optional[str], fallback: str = "school.submit.failed") -> str:
    if not error_code:
        return fallback
    return ERROR_MESSAGE_CODES.get(error_code, fallback)


def public_message_params(params: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not params:
        return {}
    allowed_keys = {"experimentName", "reason"}
    return {key: value for key, value in params.items() if key in allowed_keys}
