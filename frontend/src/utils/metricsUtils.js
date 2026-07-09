/**
 * 统一处理学生实验指标与状态
 * @param {Array} submissions - 学生所有的提交记录（按时间倒序排列）
 * @param {Array} experiments - 后端返回的实验配置列表
 * @returns {Object} 包含映射后的实验列表与聚合后的指标数据
 */
export function calculateExperimentMetrics(submissions, experiments = []) {
  const subMap = {};
  
  // 后端返回的 submissions 是按时间倒序（最新的在前）。
  // 我们只保留每个实验最新的那条记录作为该实验的当前状态。
  if (Array.isArray(submissions)) {
    submissions.forEach(sub => {
      if (!subMap[sub.experiment_id]) {
        subMap[sub.experiment_id] = sub;
      }
    });
  }

  const allExps = experiments;
  
  let completedCount = 0;
  let reviewingCount = 0;
  let draftSubmittedCount = 0;
  let unsubmittedCount = 0;
  let latestCompleted = null;

  const mappedList = allExps.map(exp => {
    const sub = subMap[exp.id];
    const status = sub ? sub.status : 'unsubmitted';
    
    const schoolStatus = exp.schoolStatus;
    if (schoolStatus === 'school_final_submitted' || schoolStatus === 'school_graded' || status === 'completed') {
      completedCount++;
      if (sub) {
        const subTimeStr = sub.updated_at || sub.created_at;
        const latestTimeStr = latestCompleted ? (latestCompleted.updated_at || latestCompleted.created_at) : null;

        // 找出最近完成的实验
        if (!latestCompleted || new Date(subTimeStr) > new Date(latestTimeStr)) {
          latestCompleted = { ...sub, experimentName: exp.name };
        }
      }
    } else if (schoolStatus === 'school_draft_submitted') {
      draftSubmittedCount++;
    } else if (['pending_payment', 'recognizing', 'reviewing', 'submitting'].includes(status)) {
      reviewingCount++;
    } else {
      unsubmittedCount++;
    }

    return {
      ...exp,
      status,
      submission_id: sub ? sub.id : null,
    };
  });

  // 安全地处理时间格式化
  let latestTime = '-';
  if (latestCompleted) {
    const timeStr = latestCompleted.updated_at || latestCompleted.created_at;
    if (timeStr) {
      latestTime = new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z').toLocaleString();
    }
  }

  return {
    mappedList,
    metrics: {
      total: allExps.length,
      unsubmitted: unsubmittedCount,
      draftSubmitted: draftSubmittedCount,
      reviewing: reviewingCount,
      completed: completedCount,
      latestName: latestCompleted ? latestCompleted.experimentName : '暂无记录',
      latestTime: latestTime
    }
  };
}
