export const AUTOMATION_MESSAGES = {
  'school.overview.syncing': '正在从学校系统同步您的概览数据，请耐心等待...',
  'school.overview.connecting': '正在准备学校系统会话...',
  'school.overview.openingLogin': '正在准备学校系统会话...',
  'school.overview.recognizingCaptcha': '正在识别登录验证码...',
  'school.overview.loggingIn': '正在确认学校系统登录结果...',
  'school.overview.checkingLogin': '正在确认学校系统登录结果...',
  'school.overview.retryingCaptcha': '验证码校验失败，正在重新识别并重试...',
  'school.overview.readingList': '正在读取完成报告列表...',
  'school.overview.savingSnapshot': '正在加载学校系统状态到平台...',
  'school.overview.success': '您的概览数据已读取完成，请查看仪表盘进行下一步操作。',
  'school.overview.failed': '当前无法连接至学校系统，原因：{reason}，若该情况持续存在，请反馈并联系管理员。',
  'school.detail.syncing': '正在从学校系统同步您的「{experimentName}」填写数据，请耐心等待...',
  'school.detail.connecting': '正在准备学校系统会话...',
  'school.detail.opening': '正在打开实验报告...',
  'school.detail.reading': '正在读取学校系统已填写内容...',
  'school.detail.savingSnapshot': '正在加载实验填写快照到平台...',
  'school.detail.success': '您的实验数据已读取完成，并已回填至当前网页，请进行下一步操作。',
  'school.detail.failed': '当前无法同步实验数据，原因：{reason}，若该情况持续存在，请反馈并联系管理员。',
  'school.submit.saving': '正在保存数据至平台...',
  'school.submit.connecting': '正在准备学校系统会话...',
  'school.submit.opening': '正在打开实验报告...',
  'school.submit.filling': '正在回填表单数据...',
  'school.submit.verifying': '正在校验写入结果...',
  'school.submit.submittingDraft': '正在执行临时提交...',
  'school.submit.submittingFinal': '正在执行正式提交...',
  'school.submit.confirming': '正在确认学校系统反馈...',
  'school.submit.returningList': '正在同步学校提交状态...',
  'school.submit.readingStatus': '正在同步学校提交状态...',
  'school.submit.updatingPlatform': '正在更新平台状态...',
  'school.submit.success': '提交成功，学校系统已更新。',
  'school.submit.draftSuccess': '临时提交成功，你可以在学校系统里查看已提交的内容。',
  'school.submit.finalSuccess': '正式提交成功，你可以在学校系统里查看已提交的内容。',
  'school.submit.failed': '提交失败，原因：{reason}，系统已保留本次平台数据快照。',
  'school.submit.verifyFailed': '部分内容未能成功写入学校系统，系统已停止提交。请稍后重试；若持续失败，请反馈并联系管理员。',
};

export function renderAutomationMessage(messageCode, messageParams = {}) {
  const template = AUTOMATION_MESSAGES[messageCode] || messageCode || '';
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    const value = messageParams?.[key];
    return value === undefined || value === null || value === '' ? '未知' : String(value);
  });
}
