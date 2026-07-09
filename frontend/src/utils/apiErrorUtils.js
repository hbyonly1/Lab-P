export function getApiErrorMessage(error, fallback = '请求失败') {
  const detail = error?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (detail && typeof detail === 'object') {
    if (detail.message) return detail.message;
    if (detail.reason) return detail.reason;
    if (detail.code === 'JOB_ALREADY_RUNNING') return '已有学校系统任务正在执行，请等待当前任务完成。';
    if (detail.code === 'IDEMPOTENCY_CONFLICT') return '已有相同任务正在执行，但请求内容不一致，请刷新后重试。';
    if (detail.code) return detail.code;
  }
  return error?.message || fallback;
}
