import { useMemo } from 'react';
import {
  AppstoreOutlined,
  CheckCircleOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  LineChartOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { GoldButton, OutlineButton, PageHeading, StatCard, StatusBadge } from '../../components/ui/index.js';

import { getAllExperiments } from '../../services/experimentConfigStore.js';

export const experimentConfigs = getAllExperiments();

export const statusMeta = {
  not_started: { label: '待处理', tone: 'pending' },
  need_upload: { label: '待提交', tone: 'submit' },
  manual_review: { label: '进行中', tone: 'processing' },
  processing: { label: '进行中', tone: 'processing' },
  submitted: { label: '已完成', tone: 'completed' },
};

export default function StudentExperimentsPage() {
  const navigate = useNavigate();

  const metrics = useMemo(
    () => ({
      total: experimentConfigs.length,
      pending: experimentConfigs.filter((item) =>
        ['not_started', 'need_upload', 'processing'].includes(item.status),
      ).length,
      reviewing: experimentConfigs.filter((item) => item.status === 'manual_review').length,
      completed: experimentConfigs.filter((item) => item.status === 'submitted').length,
    }),
    [],
  );

  return (
    <section className="workspace-standard-page student-experiments-page">
      <PageHeading title="实验提交" description="查看并提交你的全部实验任务" />

      <div className="ui-stat-grid">
        <StatCard icon={<AppstoreOutlined />} label="全部实验" value={metrics.total} tone="blue" />
        <StatCard icon={<CloudUploadOutlined />} label="待提交" value={metrics.pending} tone="amber" />
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
          {experimentConfigs.map((experiment) => {
            const meta = statusMeta[experiment.status] ?? statusMeta.not_started;
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
                  <GoldButton className="experiment-pro-button" icon={<CrownOutlined />}>
                    一键提交 (Pro)
                  </GoldButton>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
