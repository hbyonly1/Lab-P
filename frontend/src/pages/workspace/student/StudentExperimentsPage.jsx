import { useMemo, useState, useEffect } from 'react';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { message } from 'antd';
import { GoldButton, OutlineButton, PageHeading, StatCard, StatusBadge } from '../../../components/ui/index.js';
import { ProSubmitModal } from '../../../components/experiment/index.js';
import { calculateExperimentMetrics } from '../../../utils/metricsUtils.js';

import { STATUS_META } from '../../../constants/statusEnums.js';
import { getMySubmissions, submitExperiment } from '../../../services/submissionsApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import { getSchoolOverviewLatest } from '../../../services/schoolSyncApi.js';

const SCHOOL_STATUS_META = {
  school_not_submitted: { label: '未提交', tone: 'pending' },
  school_draft_submitted: { label: '临时提交', tone: 'processing' },
  school_final_submitted: { label: '正常提交', tone: 'completed' },
  school_unknown: { label: '未识别', tone: 'pending' },
  school_not_synced: { label: '未同步', tone: 'pending' },
};

function normalizeName(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function buildSchoolStatusMap(overviewExperiments = []) {
  const map = new Map();
  overviewExperiments.forEach((item) => {
    const key = normalizeName(item.experimentName);
    if (key) map.set(key, item);
  });
  return map;
}

export default function StudentExperimentsPage() {
  const navigate = useNavigate();
  const [mergedList, setMergedList] = useState([]);
  const [metrics, setMetrics] = useState({
    total: 0,
    unsubmitted: 0,
    reviewing: 0,
    completed: 0,
  });
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTargets, setSubmitTargets] = useState([]);

  const handleOneClickSubmit = (experiment) => {
    setSubmitTargets([experiment]);
    setIsSubmitModalOpen(true);
  };

  const loadData = async () => {
    try {
      const [experiments, subs, overviewLatest] = await Promise.all([
        experimentsApi.listExperiments(),
        getMySubmissions(),
        getSchoolOverviewLatest().catch(() => ({ experiments: [] })),
      ]);
      const { mappedList, metrics } = calculateExperimentMetrics(subs, experiments);
      const schoolStatusMap = buildSchoolStatusMap(overviewLatest.experiments || []);
      const listWithSchoolStatus = mappedList.map((experiment) => {
        const snapshot = schoolStatusMap.get(normalizeName(experiment.name));
        return {
          ...experiment,
          schoolStatus: snapshot?.schoolStatus || 'school_not_synced',
          originalStatusText: snapshot?.originalStatusText || '',
          schoolStatusSyncedAt: overviewLatest.lastSyncedAt || null,
        };
      });

      setMergedList(listWithSchoolStatus);
      setMetrics(metrics);
    } catch (error) {
      console.error("Failed to fetch experiments list:", error);
      const msg = error.response?.data?.detail || error.message;
      message.error(`获取实验数据失败: ${msg}`);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleModalSubmit = async (batchImages, targetStudent, isHungup = false) => {
    try {
      for (const target of submitTargets) {
        const expImages = batchImages[target.id] || {};
        const imagePaths = Object.values(expImages).flat().map(img => img.url).filter(Boolean);
        await submitExperiment(target.id, targetStudent, isHungup, imagePaths);
      }
      message.success('提交成功，后台正在处理中！');
      await loadData();
    } catch (error) {
      if (error.response?.status !== 403 && error.status !== 403) {
        const msg = error.response?.data?.detail || error.message;
        message.error(`提交失败: ${msg}`);
      }
      throw error;
    }
  };

  return (
    <section className="workspace-standard-page student-experiments-page">
      <PageHeading title="实验提交" description="查看并提交你的全部实验任务" />

      <div className="ui-stat-grid">
        <StatCard icon={<AppstoreOutlined />} label="全部实验" value={metrics.total} tone="blue" />
        <StatCard icon={<CloudUploadOutlined />} label="待提交" value={metrics.unsubmitted} tone="amber" />
        <StatCard icon={<LineChartOutlined />} label="人工审核中" value={metrics.reviewing} tone="green" />
        <StatCard icon={<CheckCircleOutlined />} label="已完成" value={metrics.completed} tone="violet" />
      </div>

      <div className="experiment-list-panel">
        <div className="experiment-list-head">
          <span>实验名称</span>
          <span>学校提交状态</span>
          <span>平台处理状态</span>
          <span>操作</span>
        </div>
        <div className="experiment-list">
          {mergedList.map((experiment) => {
            const platformMeta = STATUS_META[experiment.status] || STATUS_META.incomplete;
            const schoolMeta = SCHOOL_STATUS_META[experiment.schoolStatus] || SCHOOL_STATUS_META.school_unknown;
            return (
              <article className="experiment-row" key={experiment.id}>
                <h3>{experiment.name}</h3>
                <StatusBadge tone={schoolMeta.tone}>{schoolMeta.label}</StatusBadge>
                <StatusBadge tone={platformMeta.tone}>{platformMeta.label}</StatusBadge>
                <div className="experiment-row-actions">
                  <OutlineButton onClick={() => navigate(`/workspace/student/experiments/${experiment.id}`)}>
                    编辑
                  </OutlineButton>
                  <OutlineButton>
                    提交
                  </OutlineButton>
                  <OutlineButton>
                    在系统里查看
                  </OutlineButton>
                  <GoldButton onClick={() => handleOneClickSubmit(experiment)} icon={<CrownOutlined />}>
                    一键提交
                  </GoldButton>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      <ProSubmitModal
        open={isSubmitModalOpen}
        experiments={submitTargets}
        onCancel={() => setIsSubmitModalOpen(false)}
        onSubmit={handleModalSubmit}
      />
    </section>
  );
}
