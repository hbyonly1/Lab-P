export const AUDIT_ACTION_META = {
  full_submit: { label: '完整提交' },
  confirm_payment: { label: '确认收款' },
  upload_image: { label: '上传实验图片' },
  ai_recognize: { label: 'AI 识别图片' },
  calculate_data: { label: '计算数据' },
  generate_ai_answer: { label: '生成AI回答' },
  manual_review: { label: '人工审核' },
  auto_fill: { label: '自动填报' },
};

export const AUDIT_ACTION_LIST = Object.keys(AUDIT_ACTION_META);

export const AUDIT_STATUS_META = {
  pending: { label: '执行中', color: 'blue', tone: 'pending' },
  success: { label: '操作成功', color: 'success', tone: 'completed' },
  failed: { label: '操作失败', color: 'error', tone: 'failed' },
};

export const AUDIT_STATUS_LIST = Object.keys(AUDIT_STATUS_META);
