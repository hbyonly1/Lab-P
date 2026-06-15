import { useState } from 'react';
import { Button, Table, Tag, Tooltip } from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  LineChartOutlined,
  MoreOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getAdminUserName } from '../../auth.js';

const dashboardData = {
  plan: {
    current: 'pro',
  },
  plans: [
    {
      key: 'free',
      name: 'Free',
      subtitle: '免费',
      description: '轻量辅助。',
      features: [
        { text: '全流程提交辅助：只需上传实验材料，系统完成全流程提交', available: false },
        { text: '结构化内容辅助：固定填空、根据公式计算数据与主观题生成式回答', available: false },
        { text: '有限次数的 AI 数据识别（需自行核对识别结果）', available: true, warning: true },
        { text: '直接上传数据到实验网站', available: true },
      ],
    },
    {
      key: 'plus',
      name: 'Plus',
      subtitle: '高效识别',
      description: '获取更多特性，自动提取实验数据并整理成清晰结果。',
      features: [
        { text: '全流程提交辅助：只需上传实验材料，系统完成全流程提交', available: false },
        { text: '部分结构化内容辅助：根据公式计算数据与主观题生成式回答', available: false, warning: true },
        { text: '更多次数的 AI 数据识别（需自行核对识别结果）', available: true, warning: true },
        { text: '直接上传数据到实验网站', available: true },
      ],
    },
    {
      key: 'pro',
      name: 'Pro',
      subtitle: '全流程托管',
      description: '享受无忧的优先处理、人工核对和完整自动化填充能力。',
      features: [
        { text: '全流程提交辅助：只需上传实验材料，系统完成全流程提交', available: true },
        { text: '结构化内容辅助：固定填空、根据公式计算数据与主观题生成式回答', available: true },
        { text: '人工数据识别（无需自行核对识别结果）', available: true },
        { text: '直接上传数据到实验网站', available: true }
      ],
    },
  ],
  progress: {
    completed: 1,
    total: 6,
  },
  metrics: [
    {
      key: 'completion-status',
      label: '完成状态',
      icon: <UploadOutlined />,
      tone: 'completion',
    },
    {
      key: 'pending',
      label: '待处理实验',
      value: '3',
      icon: <ClockCircleOutlined />,
      tone: 'amber',
    },
    {
      key: 'manual-review',
      label: '人工审核中',
      value: '5',
      icon: <LineChartOutlined />,
      tone: 'green',
    },
    {
      key: 'latest',
      label: '最近审核完成',
      value: '光学实验报告',
      trend: '2 小时前',
      icon: <CheckCircleOutlined />,
      tone: 'violet',
      compact: true,
    },
  ],
  recentTasks: [
    {
      submission_id: 'sub_1001',
      experiment_name: '光学实验报告',
      experiment_type: '基础实验',
      deadline: '2025-05-28',
      status: 'completed',
      updated_at: '2 小时前',
      actions: ['view', 'download'],
    },
    {
      submission_id: 'sub_1002',
      experiment_name: '电路分析实验',
      experiment_type: '专业实验',
      deadline: '2025-05-30',
      status: 'pending_upload',
      updated_at: '1 天前',
      actions: ['edit', 'upload'],
    },
    {
      submission_id: 'sub_1003',
      experiment_name: '化学反应实验',
      experiment_type: '基础实验',
      deadline: '2025-06-02',
      status: 'reviewing',
      updated_at: '2 天前',
      actions: ['view'],
    },
    {
      submission_id: 'sub_1004',
      experiment_name: '物理力学实验',
      experiment_type: '专业实验',
      deadline: '2025-06-05',
      status: 'automation_running',
      updated_at: '3 天前',
      actions: ['edit'],
    },
  ],
};

const statusMeta = {
  completed: { label: '已完成', color: 'success' },
  pending_upload: { label: '待提交', color: 'warning' },
  reviewing: { label: '待处理', color: 'gold' },
  automation_running: { label: '进行中', color: 'processing' },
};

export default function StudentDashboardPage() {
  const navigate = useNavigate();
  const userName = getAdminUserName();
  const firstName = userName.replace(/同学$/, '') || '同学';
  const completed = dashboardData.progress.completed;
  const total = dashboardData.progress.total;
  const pending = Math.max(total - completed, 0);
  const progress = total > 0 ? completed / total : 0;

  return (
    <section className="student-dashboard-page">
      <DashboardTopbar firstName={firstName} />

      <QuickSubmitCard onSubmit={() => navigate('/workspace/student/experiments')} />

      <MetricStack completed={completed} metrics={dashboardData.metrics} total={total} />

      <div className="student-dashboard-main-grid">
        <ServicePlanCard plan={dashboardData.plan} plans={dashboardData.plans} />
        <ProgressRingCard completed={completed} pending={pending} progress={progress} total={total} />
      </div>

      <RecentTasksTable tasks={dashboardData.recentTasks} onViewAll={() => navigate('/workspace/student/experiments')} />
    </section>
  );
}

function DashboardTopbar({ firstName }) {
  return (
    <header className="student-dashboard-topbar">
      <div>
        <h1>你好，{firstName} 同学</h1>
        <p>欢迎使用CUMTB实验+</p>
      </div>
      <div className="student-dashboard-userbar">
        <Button className="dashboard-icon-button" icon={<BellOutlined />} aria-label="通知" />
      </div>
    </header>
  );
}

function QuickSubmitCard({ onSubmit }) {
  return (
    <aside className="dashboard-quick-submit-card">
      <div className="quick-submit-illustration">
        <FileTextOutlined />
      </div>
      <div>
        <strong>快速提交实验报告数据</strong>
        <p>无需打开实验网站，一站式操作。</p>
      </div>
      <div className="quick-submit-actions">
        <Button className="quick-submit-pro-button" onClick={onSubmit}>
          一键提交全部（Pro）&gt;
        </Button>
        <Button type="primary" onClick={onSubmit}>
          去手动提交 &gt;
        </Button>
      </div>
    </aside>
  );
}

function ServicePlanCard({ plan, plans }) {
  const [previewPlanKey, setPreviewPlanKey] = useState(plan.current);
  const currentPlan = plans.find((item) => item.key === plan.current) ?? plans[0];
  const previewPlan = plans.find((item) => item.key === previewPlanKey) ?? currentPlan;

  return (
    <section className="dashboard-plan-card">
      <div className="dashboard-card-title">
        <div>
          <h2>
            当前服务计划：<span>{currentPlan.name}</span>
          </h2>
        </div>
        <Button className="dashboard-plan-manage-button" icon={<SettingOutlined />}>
          升级套餐
        </Button>
        <p>
          <b>{previewPlan.name}</b>：{previewPlan.description}
        </p>
      </div>

      <div className="dashboard-plan-tabs" aria-label="服务计划档位">
        {plans.map((item) => (
          <button
            className={item.key === previewPlanKey ? 'active' : ''}
            key={item.key}
            onClick={() => setPreviewPlanKey(item.key)}
            type="button"
          >
            <strong>{item.name}</strong>
            <span>{item.subtitle}</span>
          </button>
        ))}
      </div>

      <div className="dashboard-plan-feature-grid">
        {previewPlan.features.map((feature) => {
          const featureMeta = typeof feature === 'string' ? { text: feature, available: true } : feature;
          const featureClass = [
            featureMeta.available ? 'is-available' : 'is-unavailable',
            featureMeta.warning ? 'is-warning' : '',
          ]
            .filter(Boolean)
            .join(' ');

          return (
            <span className={featureClass} key={featureMeta.text}>
              {featureMeta.warning ? (
                <ExclamationCircleOutlined />
              ) : featureMeta.available ? (
                <CheckOutlined />
              ) : (
                <CloseOutlined />
              )}
              {featureMeta.text}
            </span>
          );
        })}
      </div>

    </section>
  );
}

function ProgressRingCard({ completed, pending, progress, total }) {
  const percent = Math.round(progress * 100);

  return (
    <section className="dashboard-progress-card">
      <div className="dashboard-card-title compact">
        <h2>实验完成进度</h2>
      </div>
      <div className="dashboard-progress-ring-wrap">
        <ProgressRing percent={percent} />
        <div className="dashboard-progress-copy">
          <strong>{percent}%</strong>
          <span>已完成</span>
          <p>
            <b>{completed}</b> / {total} 项实验
          </p>
        </div>
      </div>
      <div className="dashboard-progress-legend">
        <span className="completed">已完成 {completed}</span>
        <span>未完成 {pending}</span>
      </div>
    </section>
  );
}

function ProgressRing({ percent }) {
  const radius = 84;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - percent / 100);

  return (
    <div className="dashboard-progress-ring" aria-label={`实验完成进度 ${percent}%`}>
      <svg viewBox="0 0 210 210" role="img">
        <circle className="progress-ring-track" cx="105" cy="105" r={radius} />
        <circle
          className="progress-ring-value"
          cx="105"
          cy="105"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
    </div>
  );
}

function MetricStack({ completed, metrics, total }) {
  const allCompleted = total > 0 && completed >= total;

  return (
    <aside className="dashboard-metric-stack">
      {metrics.map((metric) => {
        const isCompletion = metric.key === 'completion-status';
        const value = isCompletion ? (allCompleted ? '全部完成' : '未完成') : metric.value;
        const cardClass = [
          'dashboard-metric-card',
          `is-${metric.tone}`,
          metric.compact ? 'is-compact' : '',
          isCompletion ? 'is-completion' : '',
          isCompletion && allCompleted ? 'is-completed' : '',
          isCompletion && !allCompleted ? 'is-incomplete' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <article className={cardClass} key={metric.key}>
            <span className="metric-icon">{metric.icon}</span>
            <div>
              <span>{metric.label}</span>
              <strong>{value}</strong>
            </div>
            {metric.trend && <p>{metric.trend}</p>}
          </article>
        );
      })}
    </aside>
  );
}

function RecentTasksTable({ tasks, onViewAll }) {
  const columns = [
    {
      title: '实验名称',
      dataIndex: 'experiment_name',
      key: 'experiment_name',
      render: (name) => (
        <span className="recent-task-name">
          <FileTextOutlined />
          {name}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const meta = statusMeta[status] ?? statusMeta.reviewing;
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '最后更新',
      dataIndex: 'updated_at',
      key: 'updated_at',
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, record) => (
        <div className="recent-task-actions">
          <TooltipButton icon={<EyeOutlined />} label="查看" />
          <TooltipButton icon={<EditOutlined />} label="编辑" />
        </div>
      ),
    },
  ];

  return (
    <section className="dashboard-recent-panel">
      <div className="dashboard-recent-head">
        <h2>最近任务</h2>
        <Button onClick={onViewAll}>查看全部</Button>
      </div>
      <Table
        columns={columns}
        dataSource={tasks}
        pagination={false}
        rowKey="submission_id"
        scroll={{ x: 620 }}
      />
    </section>
  );
}

function TooltipButton({ icon, label }) {
  return (
    <Tooltip title={label}>
      <Button icon={icon} aria-label={label} />
    </Tooltip>
  );
}
