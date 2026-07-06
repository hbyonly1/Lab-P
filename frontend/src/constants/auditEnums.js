export const AUDIT_ACTION_META = {
  // === 订单与支付 (Order & Payment) ===
  order_created: { label: '创建订单', type: 'info' },
  payment_reported: { label: '用户提交支付确认', type: 'warning' },
  payment_verified: { label: '管理员确认收款', type: 'success' },
  payment_rejected: { label: '管理员驳回收款', type: 'error' },

  // === 任务与基础操作 (Task & Base) ===
  files_uploaded: { label: '上传实验原始数据', type: 'info' },
  task_claimed: { label: '审核员领取任务', type: 'info' },
  results_corrected: { label: '人工提交纠错', type: 'success' },

  // === 实验辅助工具 (Plus/Pro AI & Compute) ===
  auto_fill: { label: '使用一键填空 (常量)', type: 'info' },
  calculate_data: { label: '使用公式推导计算', type: 'info' },
  generate_ai_answer: { label: '生成AI简答题', type: 'info' },
  ai_recognition_started: { label: '启动 AI 图像识别', type: 'info' },
  ai_recognition_completed: { label: 'AI 图像识别完成', type: 'success' },
  ai_recognition_failed: { label: 'AI 图像识别失败', type: 'error' },

  // === 学校系统提交 ===
  school_draft_submit_started: { label: '学校系统临时提交开始', type: 'info' },
  school_draft_submit_completed: { label: '学校系统临时提交成功', type: 'success' },
  school_draft_submit_failed: { label: '学校系统临时提交失败', type: 'error' },
  school_final_submit_started: { label: '学校系统正式提交开始', type: 'info' },
  school_final_submit_completed: { label: '学校系统正式提交成功', type: 'success' },
  school_final_submit_failed: { label: '学校系统正式提交失败', type: 'error' }
};

export const AUDIT_ACTION_LIST = Object.keys(AUDIT_ACTION_META);

export const AUDIT_STATUS_META = {
  pending: { label: '执行中', color: 'blue', tone: 'pending' },
  success: { label: '操作成功', color: 'success', tone: 'completed' },
  failed: { label: '操作失败', color: 'error', tone: 'failed' },
};

export const AUDIT_STATUS_LIST = Object.keys(AUDIT_STATUS_META);
