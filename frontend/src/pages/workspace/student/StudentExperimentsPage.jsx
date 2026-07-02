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
      const [experiments, subs] = await Promise.all([
        experimentsApi.listExperiments(),
        getMySubmissions(),
      ]);
      const { mappedList, metrics } = calculateExperimentMetrics(subs, experiments);

      setMergedList(mappedList);
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
          <span>状态</span>
          <span>操作</span>
        </div>
        <div className="experiment-list">
          {mergedList.map((experiment) => {
            const meta = STATUS_META[experiment.status] || { label: '未提交', color: 'default', tone: 'pending' };
            return (
              <article className="experiment-row" key={experiment.id}>
                <h3>{experiment.name}</h3>
                <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
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
