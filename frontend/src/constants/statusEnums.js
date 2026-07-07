export const STATUS_META = {
  incomplete: { label: '未完成', color: 'gold', tone: 'submit' },
  draft_submitted: { label: '已临时提交', color: 'blue', tone: 'processing' },
  pending_payment: { label: '待核实付款', color: 'orange', tone: 'pending' },
  pending_image_assignment: { label: '待图片匹配', color: 'orange', tone: 'pending' },
  pending_recognition: { label: '待自动识别', color: 'cyan', tone: 'pending' },
  recognizing: { label: 'AI 识别中', color: 'purple', tone: 'processing' },
  preparing_review: { label: 'AI 预处理中', color: 'purple', tone: 'processing' },
  reviewing: { label: '待人工审核', color: 'processing', tone: 'processing' },
  submitting: { label: '自动填写中', color: 'blue', tone: 'processing' },
  completed: { label: '正式提交完成', color: 'success', tone: 'completed' },
  error: { label: '处理异常', color: 'error', tone: 'failed' },
};

export const STATUS_LIST = Object.keys(STATUS_META);

export const OVERALL_STATUS_META = {
  incomplete: { label: '未全部完成', color: 'gold', tone: 'pending' },
  completed: { label: '全部已完成', color: 'success', tone: 'completed' },
};
export const OVERALL_STATUS_LIST = Object.keys(OVERALL_STATUS_META);

export const REVIEW_STATUS_META = {
  incomplete: { label: '未完成', color: 'gold', tone: 'pending' },
  completed: { label: '完成', color: 'success', tone: 'completed' },
};
export const REVIEW_STATUS_LIST = Object.keys(REVIEW_STATUS_META);
export const REVIEW_COMPLETED_SUBMISSION_STATUSES = ['draft_submitted', 'completed'];

export const ORDER_STATUS_META = {
  pending_payment: { label: '待核实', tone: 'pending', color: 'orange' },
  paid: { label: '已收款', tone: 'success', color: 'success' },
  rejected: { label: '已驳回', tone: 'failed', color: 'error' },
};
export const ORDER_STATUS_LIST = Object.keys(ORDER_STATUS_META);
