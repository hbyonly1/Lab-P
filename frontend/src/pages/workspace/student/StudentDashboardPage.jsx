import { useState, useEffect } from 'react';
import { Button, Table, Tag, Tooltip, message, Badge } from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CrownOutlined,
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
import { GoldButton, OutlineButton, TablePanel, UpgradePlanModal, AnnouncementDrawer } from '../../components/ui/index.js';
import { ProSubmitModal } from '../../components/experiment/index.js';
import { getAllExperiments } from '../../services/experimentConfigStore.js';
import {
  getDebugServiceCapabilities,
  getDebugServiceRole,
  subscribeDebugServiceRole,
} from './debugRoleStore.js';
import { STATUS_META, OVERALL_STATUS_META } from '../../constants/statusEnums.js';

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
        { text: '自动化数据处理：固定填空、根据公式计算数据与主观题生成式回答', available: false },
        { text: 'AI 智能视觉提取：可供体验的实验数据图片解析并自动回填（需自行核对识别结果）', available: true, warning: true },
        { text: '直接上传数据到实验网站', available: true },
      ],
    },
    {
      key: 'pay_per_use',
      name: '按次付费',
      subtitle: '单次代劳',
      description: '适合仅需完成个别实验的用户。',
      features: [
        { text: '全流程提交辅助：只需上传实验材料，系统完成全流程提交', available: true },
        { text: '自动化数据处理：固定填空、根据公式计算数据与主观题生成式回答', available: false },
        { text: 'AI 智能视觉提取：无高级提取权限', available: false },
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
        { text: '半自动化数据处理：根据公式计算数据与主观题生成式回答（存在限制）', available: true, warning: true },
        { text: 'AI 智能视觉提取：更多次数的实验数据图片解析并自动回填（需自行核对识别结果）', available: true, warning: true },
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
        { text: '全自动化数据处理：固定填空、根据公式计算数据与主观题生成式回答', available: true },
        { text: '人工提取与自动填写：人工的实验图片数据解析并填写（无需自行核对识别结果）', available: true },
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
      label: '总进度',
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
      experiment_id: 'exp-001',
      experiment_name: '光学实验报告',
      experiment_type: '基础实验',
      deadline: '2025-05-28',
      status: 'completed',
      updated_at: '2 小时前',
      actions: ['view', 'download'],
    },
    {
      submission_id: 'sub_1002',
      experiment_id: 'exp-002',
      experiment_name: '电路分析实验',
      experiment_type: '专业实验',
      deadline: '2025-05-30',
      status: 'incomplete',
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
      status: 'not_started',
      updated_at: '3 天前',
      actions: ['edit'],
    },
  ],
};

export default function StudentDashboardPage() {
  const navigate = useNavigate();
  const userName = getAdminUserName();
  const firstName = userName.replace(/同学$/, '') || '同学';
  const completed = dashboardData.progress.completed;
  const total = dashboardData.progress.total;
  const pending = Math.max(total - completed, 0);
  const progress = total > 0 ? completed / total : 0;

  const [debugRole, setDebugRole] = useState(() => getDebugServiceRole());
  useEffect(() => subscribeDebugServiceRole(setDebugRole), []);
  const capabilities = getDebugServiceCapabilities(debugRole);

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTargets, setSubmitTargets] = useState([]);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);

  const handleBatchSubmitClick = () => {
    const allExps = getAllExperiments();
    const pendingExps = allExps.filter(exp => ['not_started', 'need_upload'].includes(exp.status));

    setSubmitTargets(pendingExps);
    setIsSubmitModalOpen(true);
  };

  const handleModalSubmit = async (batchImages) => {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, 1500);
    });
  };

  return (
    <section className="workspace-standard-page student-dashboard-page">
      <DashboardTopbar firstName={firstName} />

      <QuickSubmitCard
        onBatchSubmit={handleBatchSubmitClick}
        onManualSubmit={() => navigate('/workspace/student/experiments')}
      />

      <MetricStack completed={completed} metrics={dashboardData.metrics} total={total} />

      <div className="student-dashboard-main-grid">
        <ServicePlanCard plan={{ current: debugRole }} plans={dashboardData.plans} onUpgrade={() => setIsUpgradeModalOpen(true)} />
        <ProgressRingCard completed={completed} pending={pending} progress={progress} total={total} />
      </div>

      <RecentTasksTable tasks={dashboardData.recentTasks} onViewAll={() => navigate('/workspace/student/experiments')} />
      <ProSubmitModal
        open={isSubmitModalOpen}
        experiments={submitTargets}
        onCancel={() => setIsSubmitModalOpen(false)}
        onSubmit={handleModalSubmit}
      />
      <UpgradePlanModal
        open={isUpgradeModalOpen}
        onClose={() => setIsUpgradeModalOpen(false)}
        plans={dashboardData.plans}
        currentPlan={debugRole}
      />
    </section>
  );
}

const MOCK_ANNOUNCEMENTS = [
  {
    id: 'ann-1',
    title: '系统维护通知',
    content: '为了提供更好的服务，实验报告系统将于本周五晚 20:00 进行升级维护，期间将暂停服务约 2 小时，请合理安排提交时间。',
    type: 'update',
    is_read: false,
    created_at: '2026-06-30 08:00:00'
  },
  {
    id: 'ann-2',
    title: '期末提交警告',
    content: '严禁任何形式的学术不端行为，系统已升级风控监测，一经发现将直接通报辅导员，请各位同学诚实守信。',
    type: 'notice',
    is_read: false,
    created_at: '2026-06-29 14:00:00'
  },
  {
    id: 'ann-3',
    title: 'Pro 套餐限时优惠',
    content: '期末冲刺福利，Pro 套餐直降 20%，现在升级即可享受全部自动化填报特权！',
    type: 'promotion',
    is_read: true,
    created_at: '2026-06-25 10:00:00'
  }
];

function DashboardTopbar({ firstName }) {
  const [announcements, setAnnouncements] = useState(MOCK_ANNOUNCEMENTS);
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);

  const unreadCount = announcements.filter((a) => !a.is_read).length;

  const handleMarkAsRead = (id) => {
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === id ? { ...a, is_read: true } : a))
    );
  };

  const handleMarkAllRead = () => {
    setAnnouncements((prev) =>
      prev.map((a) => ({ ...a, is_read: true }))
    );
  };

  return (
    <header className="student-dashboard-topbar">
      <div>
        <h1>你好，{firstName} 同学</h1>
        <p>Have a nice day!</p>
      </div>
      <div className="student-dashboard-userbar">
        <Badge dot={unreadCount > 0} offset={[-4, 4]}>
          <Button 
            className={`ui-icon-button ${unreadCount > 0 ? 'bell-unread-ripple' : ''}`} 
            icon={<BellOutlined />} 
            aria-label="通知"
            onClick={() => setIsDrawerVisible(true)}
          />
        </Badge>
      </div>

      <AnnouncementDrawer
        visible={isDrawerVisible}
        onClose={() => setIsDrawerVisible(false)}
        announcements={announcements}
        onMarkAsRead={handleMarkAsRead}
        onMarkAllRead={handleMarkAllRead}
      />
    </header>
  );
}

function QuickSubmitCard({ onBatchSubmit, onManualSubmit }) {
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
        <GoldButton onClick={onBatchSubmit} icon={<CrownOutlined />}>
          一键批量提交 &gt;
        </GoldButton>
        <Button type="primary" onClick={onManualSubmit}>
          去手动提交 &gt;
        </Button>
      </div>
    </aside>
  );
}

function ServicePlanCard({ plan, plans, onUpgrade }) {
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
        <GoldButton icon={<SettingOutlined />} onClick={onUpgrade}>
          升级套餐
        </GoldButton>
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

      <div style={{ marginTop: 'auto', paddingTop: '5px', fontSize: '12px', color: '#8c8c8c', textAlign: 'center' }}>
        不想购买套餐？您可以在带有皇冠标识的一键提交操作时选择低至 ¥8/次的单次付费。
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
        const value = isCompletion
          ? OVERALL_STATUS_META[allCompleted ? 'completed' : 'incomplete'].label
          : metric.value;
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
              <span className="metric-label-row">
                <span>{metric.label}</span>
                {metric.trend && <p>{metric.trend}</p>}
              </span>
              <strong>{value}</strong>
            </div>
          </article>
        );
      })}
    </aside>
  );
}

function RecentTasksTable({ tasks, onViewAll }) {
  const navigate = useNavigate();

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
        const meta = STATUS_META[status] ?? STATUS_META.not_started;
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
      render: (_, record) => {
        return (
          <div className="recent-task-actions">
            <TooltipButton icon={<EyeOutlined />} label="在系统里查看" onClick={() => navigate(`/workspace/student/experiments/${record.experiment_id || 'exp-001'}`)} />
            <TooltipButton icon={<EditOutlined />} label="编辑" onClick={() => navigate(`/workspace/student/experiments/${record.experiment_id || 'exp-001'}`)} />
          </div>
        );
      },
    },
  ];

  return (
    <TablePanel title="最近任务" actions={<OutlineButton onClick={onViewAll}>查看全部</OutlineButton>}>
      <Table
        columns={columns}
        dataSource={tasks}
        pagination={false}
        rowKey="submission_id"
        scroll={{ x: 620 }}
      />
    </TablePanel>
  );
}

function TooltipButton({ icon, label, ...props }) {
  return (
    <Tooltip title={label}>
      <OutlineButton icon={icon} aria-label={label} {...props} />
    </Tooltip>
  );
}
