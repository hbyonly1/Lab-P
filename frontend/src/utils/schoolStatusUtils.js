export const SCHOOL_STATUS_META = {
  school_not_submitted: { label: '未提交', tone: 'pending' },
  school_draft_submitted: { label: '临时提交', tone: 'processing' },
  school_final_submitted: { label: '正式提交', tone: 'completed' },
  school_graded: { label: '已评分', tone: 'warning', indicator: 'warning' },
  school_unknown: { label: '未识别', tone: 'pending' },
  school_not_synced: { label: '未同步', tone: 'pending' },
};

export function getSchoolStatusMeta(status, item = {}) {
  const meta = SCHOOL_STATUS_META[status] || SCHOOL_STATUS_META.school_unknown;
  if (status === 'school_graded') {
    return {
      ...meta,
      label: item.score ? `已评分：${item.score}` : meta.label,
    };
  }
  return meta;
}

export function normalizeSchoolExperimentName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function buildSchoolStatusMap(overviewExperiments = []) {
  const map = new Map();
  overviewExperiments.forEach((item) => {
    const key = normalizeSchoolExperimentName(item.experimentName);
    if (key) map.set(key, item);
  });
  return map;
}

export function applySchoolStatusToExperiments(experiments = [], overviewLatest = {}) {
  const schoolStatusMap = buildSchoolStatusMap(overviewLatest.experiments || []);
  return experiments.map((experiment) => {
    const snapshot = schoolStatusMap.get(normalizeSchoolExperimentName(experiment.name));
    return {
      ...experiment,
      schoolStatus: snapshot?.schoolStatus || 'school_not_synced',
      originalStatusText: snapshot?.originalStatusText || '',
      score: snapshot?.score || '',
      schoolStatusSource: snapshot?.schoolStatusSource || 'school_complete_report_list',
      schoolStatusSyncedAt: snapshot?.schoolStatusSyncedAt || overviewLatest.lastSyncedAt || null,
    };
  });
}
