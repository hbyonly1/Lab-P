export const ASYNC_TASK_PROGRESS_PROFILES = {
  fixedFill: [
    { afterSeconds: 0, percent: 20, message: '固定填空任务已提交...' },
    { afterSeconds: 4, percent: 42, message: '正在读取实验固定填空数据...' },
    { afterSeconds: 12, percent: 68, message: '正在准备回填内容...' },
    { afterSeconds: 28, percent: 84, message: '固定填空仍在处理中，完成后会自动写入页面...' },
  ],
  imageRecognition: [
    { afterSeconds: 0, percent: 18, message: 'AI 识别任务已提交...' },
    { afterSeconds: 6, percent: 30, message: '正在读取图片内容并定位表格区域...' },
    { afterSeconds: 16, percent: 45, message: '正在提取手写数据，识别数据较多时会久一点...' },
    { afterSeconds: 32, percent: 62, message: '正在结合实验配置校对字段位置和单位...' },
    { afterSeconds: 60, percent: 78, message: '模型仍在处理，识别完成后会自动回填，可继续编辑其他内容...' },
    { afterSeconds: 120, percent: 88, message: '本次识别耗时较长，后台任务仍在运行，请保持页面打开或稍后查看日志。' },
  ],
  answerGeneration: [
    { afterSeconds: 0, percent: 18, message: '生成回答任务已提交...' },
    { afterSeconds: 8, percent: 38, message: '正在结合当前实验数据生成回答...' },
    { afterSeconds: 24, percent: 62, message: '正在整理回答表达，稍等一下...' },
    { afterSeconds: 60, percent: 84, message: '回答生成时间较长，后台仍在处理，可继续编辑其他内容...' },
  ],
  formulaCompute: [
    { afterSeconds: 0, percent: 35, message: '正在计算实验数据...' },
    { afterSeconds: 4, percent: 58, message: '正在检查公式输入和依赖字段...' },
  ],
};

export function getAsyncTaskProgressStage(profile, elapsedSeconds = 0) {
  if (!Array.isArray(profile) || profile.length === 0) return null;

  return profile.reduce((current, stage) => {
    if (elapsedSeconds >= stage.afterSeconds) return stage;
    return current;
  }, profile[0]);
}
