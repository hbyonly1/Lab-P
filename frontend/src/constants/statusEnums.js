export const STATUS_META = {
  not_started: { label: '未开始', color: 'default', tone: 'pending' },
  incomplete: { label: '未完成', color: 'gold', tone: 'submit' },
  pending_payment: { label: '待核实付款', color: 'orange', tone: 'pending' },
  reviewing: { label: '人工审核中', color: 'processing', tone: 'processing' },
  completed: { label: '已完成', color: 'success', tone: 'completed' },
  error: { label: '处理异常', color: 'error', tone: 'failed' },
};

export const STATUS_LIST = Object.keys(STATUS_META);

export const OVERALL_STATUS_META = {
  incomplete: { label: '未全部完成', color: 'gold', tone: 'pending' },
  completed: { label: '全部已完成', color: 'success', tone: 'completed' },
};
export const OVERALL_STATUS_LIST = Object.keys(OVERALL_STATUS_META);

export const ORDER_STATUS_META = {
  pending_payment: { label: '待核实', tone: 'pending', color: 'orange' },
  paid: { label: '已收款', tone: 'success', color: 'success' },
  rejected: { label: '已驳回', tone: 'failed', color: 'error' },
};
export const ORDER_STATUS_LIST = Object.keys(ORDER_STATUS_META);
export const AUDIT_ACTION_META = {
  // 订单与支付 (Order & Payment)
  order_created: { label: '创建订单', type: 'info' },
  payment_reported: { label: '用户提交支付确认', type: 'warning' },
  payment_verified: { label: '管理员确认收款', type: 'success' },
  payment_rejected: { label: '管理员驳回收款', type: 'error' },

  // 任务与图片上传 (Task & Upload)
  files_uploaded: { label: '上传实验原始数据', type: 'info' },
  ai_recognition_started: { label: '启动 AI 识别', type: 'info' },
  ai_recognition_completed: { label: 'AI 识别完成', type: 'success' },
  ai_recognition_failed: { label: 'AI 识别失败', type: 'error' },

  // 审核与纠错 (Review)
  task_claimed: { label: '审核员领取任务', type: 'info' },
  results_corrected: { label: '人工提交纠错', type: 'success' },

  // 自动化填报 (Automation)
  auto_submit_started: { label: '启动自动化填报', type: 'info' },
  auto_submit_completed: { label: '自动化填报成功', type: 'success' },
  auto_submit_failed: { label: '自动化填报失败', type: 'error' }
};

export const AUDIT_ACTION_LIST = Object.keys(AUDIT_ACTION_META);
