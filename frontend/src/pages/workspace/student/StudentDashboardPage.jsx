import { useCallback, useEffect, useState } from 'react';
import { Button, Table, Tag, Tooltip, message, Badge } from 'antd';
import {
  AppstoreOutlined,
  BellOutlined,
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CloudUploadOutlined,
  CrownOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  EyeOutlined,
  FileTextOutlined,
  LineChartOutlined,
  MoreOutlined,
  ReloadOutlined,
  SettingOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getAdminStudentNo, getAdminUserName, saveAdminStudentNo, saveAdminUserName } from '../../../auth.js';
import { AutomationProgressModal, GoldButton, OutlineButton, TablePanel, AnnouncementDrawer, UpgradePlanModal } from '../../../components/ui/index.js';
import { ProSubmitModal } from '../../../components/experiment/index.js';
import { calculateExperimentMetrics } from '../../../utils/metricsUtils.js';
import { auditApi } from '../../../services/auditApi.js';
import { getMe } from '../../../services/authApi.js';
import { getMySubmissions } from '../../../services/submissionsApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import { getSchoolOverviewLatest, startSchoolOverviewSync } from '../../../services/schoolSyncApi.js';
import { getActiveAutomationJobs } from '../../../services/automationJobsApi.js';
import { STATUS_META, OVERALL_STATUS_META } from '../../../constants/statusEnums.js';
import { AUDIT_ACTION_META } from '../../../constants/auditEnums.js';
import { submitOneClickExperimentBatch } from '../../../utils/oneClickSubmitUtils.js';

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
        { text: '半自动化数据处理：根据公式计算数据与主观题生成式回答', available: true, warning: true },
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
};

export default function StudentDashboardPage() {
  const navigate = useNavigate();
  const cachedRealName = getAdminUserName();
  const cachedStudentNo = getAdminStudentNo();
  const [realName, setRealName] = useState(cachedRealName);
  const [studentNo, setStudentNo] = useState(cachedStudentNo);

  const [recentOperations, setRecentOperations] = useState([]);
  const [currentPlan, setCurrentPlan] = useState('free');
  const [experiments, setExperiments] = useState([]);
  const [metricsData, setMetricsData] = useState({
    completed: 0,
    total: 0,
    reviewing: 0,
    unsubmitted: 0,
    latestName: '暂无记录',
    latestTime: '-',
  });

  const completed = metricsData.completed;
  const total = metricsData.total;
  const pending = metricsData.unsubmitted;
  const progress = total > 0 ? completed / total : 0;

  const dynamicMetrics = [
    {
      key: 'completion-status',
      label: '总进度',
      icon: <AppstoreOutlined />,
      tone: 'completion',
    },
    {
      key: 'pending',
      label: '待提交',
      value: String(pending),
      icon: <CloudUploadOutlined />,
      tone: 'amber',
    },
    {
      key: 'manual-review',
      label: '人工审核中',
      value: String(metricsData.reviewing),
      icon: <LineChartOutlined />,
      tone: 'green',
    },
    {
      key: 'latest',
      label: '最近审核完成',
      value: metricsData.latestName,
      trend: metricsData.latestTime,
      icon: <CheckCircleOutlined />,
      tone: 'violet',
      compact: true,
    },
  ];

  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
  const [submitTargets, setSubmitTargets] = useState([]);
  const [isUpgradeModalOpen, setIsUpgradeModalOpen] = useState(false);
  const [isOverviewSyncing, setIsOverviewSyncing] = useState(false);
  const [overviewJob, setOverviewJob] = useState(null);
  const [isOverviewModalOpen, setIsOverviewModalOpen] = useState(false);
  const [lastOverviewSyncedAt, setLastOverviewSyncedAt] = useState(null);

  const refreshUserProfile = useCallback(async () => {
    const data = await getMe();
    const nextRealName = data.real_name || '';
    const nextStudentNo = data.student_no || '';
    setCurrentPlan(data.capabilities?.plan || 'free');
    setRealName(nextRealName);
    setStudentNo(nextStudentNo);
    saveAdminUserName(nextRealName);
    saveAdminStudentNo(nextStudentNo);
    return data;
  }, []);

  const refreshOverviewLatest = useCallback(async () => {
    const latest = await getSchoolOverviewLatest();
    setLastOverviewSyncedAt(latest.lastSyncedAt || null);
    return latest;
  }, []);

  const triggerOverviewSync = async ({ force = false } = {}) => {
    setIsOverviewSyncing(true);
    try {
      const job = await startSchoolOverviewSync({ force });
      setOverviewJob(job);
      setIsOverviewModalOpen(true);
    } catch (err) {
      const detail = err.response?.data?.detail;
      const activeJob = detail?.job;
      if (err.response?.status === 409 && activeJob) {
        setOverviewJob(activeJob);
        setIsOverviewModalOpen(true);
      } else {
        message.error(err.response?.data?.detail || err.message || '学校系统同步失败');
        setIsOverviewSyncing(false);
      }
    }
  };

  useEffect(() => {
    const fetchRecent = async () => {
      try {
        const [experimentList, data] = await Promise.all([
          experimentsApi.listExperiments(),
          getMySubmissions(),
        ]);
        setExperiments(experimentList);
        const { metrics } = calculateExperimentMetrics(data, experimentList);
        setMetricsData(metrics);
      } catch (err) {
        console.error('Failed to load metrics:', err);
      }
    };

    const fetchAudit = async () => {
      try {
        const data = await auditApi.getMyAuditLogs();
        setRecentOperations((data || []).filter((item) => AUDIT_ACTION_META[item.action]));
      } catch (err) {
        console.error('Failed to fetch recent operations:', err);
      }
    };

    const fetchUserPlan = async () => {
      try {
        await refreshUserProfile();
      } catch (err) {
        console.error('Failed to load user profile:', err);
      }
    };

    fetchRecent();
    fetchAudit();
    fetchUserPlan();
  }, [refreshUserProfile]);

  useEffect(() => {
    let cancelled = false;
    const autoSyncOverview = async () => {
      try {
        const activeJobs = await getActiveAutomationJobs({ action: 'school_overview_sync' });
        if (!cancelled && activeJobs?.length > 0) {
          setOverviewJob(activeJobs[0]);
          setIsOverviewModalOpen(true);
          setIsOverviewSyncing(true);
          return;
        }
        const latest = await refreshOverviewLatest();
        if (!cancelled && latest.shouldSync) {
          await triggerOverviewSync({ force: false });
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to check school overview sync:', err);
        }
      }
    };
    autoSyncOverview();
    return () => {
      cancelled = true;
    };
  }, [refreshOverviewLatest]);

  const handleBatchSubmitClick = () => {
    const pendingExps = experiments.filter(exp => ['not_started', 'need_upload'].includes(exp.status));

    setSubmitTargets(pendingExps);
    setIsSubmitModalOpen(true);
  };

  const handleModalSubmit = async (batchImages, targetStudent, isHungup = false, planName = 'pay_per_use') => {
    try {
      const { submittedCount } = await submitOneClickExperimentBatch({
        targets: submitTargets,
        batchImages,
        targetStudent,
        isHungup,
        planName,
      });

      if (submittedCount === 0) {
        message.warning('请至少上传一个实验的图片');
        return;
      }

      message.success('批量提交成功！任务已进入处理队列。');
      setTimeout(() => {
        setIsSubmitModalOpen(false);
        window.location.reload(); // 刷新控制面板数据
      }, 1500);
    } catch (e) {
      if (e.response?.status !== 403 && e.status !== 403) {
        const msg = e.response?.data?.detail || e.message;
        message.error(`提交失败: ${msg}`);
      }
      throw e; // 继续抛出让下层拦截并弹出二维码
    }
  };

  return (
    <section className="workspace-standard-page student-dashboard-page">
      <DashboardTopbar
        realName={realName}
        studentNo={studentNo}
        isOverviewSyncing={isOverviewSyncing}
        lastSyncedAt={lastOverviewSyncedAt}
        onManualSync={() => triggerOverviewSync({ force: true })}
      />

      <QuickSubmitCard
        onBatchSubmit={handleBatchSubmitClick}
        onManualSubmit={() => navigate('/workspace/student/experiments')}
      />

      <MetricStack completed={completed} metrics={dynamicMetrics} total={total} />

      <div className="student-dashboard-main-grid">
        <ServicePlanCard
          plan={{ current: currentPlan }}
          plans={dashboardData.plans}
          onUpgrade={() => setIsUpgradeModalOpen(true)}
        />
        <ProgressRingCard completed={completed} pending={pending} progress={progress} total={total} />
      </div>

      <RecentOperationsTable operations={recentOperations} />
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
        currentPlan={currentPlan}
      />
      <AutomationProgressModal
        open={isOverviewModalOpen}
        initialJob={overviewJob}
        title="学校系统概览同步"
        steps={[
          'school.overview.connecting',
          'school.overview.recognizingCaptcha',
          'school.overview.checkingLogin',
          'school.overview.readingList',
          'school.overview.savingSnapshot',
        ]}
        stepAliases={{
          'school.overview.syncing': 'school.overview.connecting',
          'school.overview.openingLogin': 'school.overview.connecting',
          'school.overview.loggingIn': 'school.overview.checkingLogin',
          'school.overview.retryingCaptcha': 'school.overview.recognizingCaptcha',
        }}
        defaultMessageCode="school.overview.syncing"
        failureMessageCode="school.overview.failed"
        onJobUpdate={(job) => {
          if (['succeeded', 'failed'].includes(job.status)) {
            setIsOverviewSyncing(false);
          }
          if (job.status === 'succeeded') {
            refreshUserProfile().catch((err) => console.error('Failed to refresh user profile:', err));
            refreshOverviewLatest().catch((err) => console.error('Failed to refresh overview latest:', err));
          }
        }}
        onClose={() => {
          setIsOverviewModalOpen(false);
          setIsOverviewSyncing(false);
          refreshUserProfile().catch((err) => console.error('Failed to refresh user profile:', err));
          refreshOverviewLatest().catch((err) => console.error('Failed to refresh overview latest:', err));
        }}
      />
    </section>
  );
}

const MOCK_ANNOUNCEMENTS = [];

function formatLastSyncedAt(value) {
  if (!value) return '暂无';
  const rawValue = String(value);
  const utcValue = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(rawValue) ? rawValue : `${rawValue}Z`;
  const date = new Date(utcValue);
  if (Number.isNaN(date.getTime())) return '暂无';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day} ${byType.hour}:${byType.minute}:${byType.second}`;
}

function DashboardTopbar({ realName, studentNo, isOverviewSyncing, lastSyncedAt, onManualSync }) {
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
        <h1>{realName ? `你好，${realName} 同学` : '你好，姓名未同步'}</h1>
        <p>{studentNo ? `学号：${studentNo}` : '学校账号待同步'}</p>
      </div>
      <div className="student-dashboard-userbar">
        <span className="student-dashboard-last-sync">
          上次同步时间：{formatLastSyncedAt(lastSyncedAt)}
        </span>
        <Button
          className="student-dashboard-sync-button"
          icon={<ReloadOutlined spin={isOverviewSyncing} />}
          loading={isOverviewSyncing}
          onClick={onManualSync}
        >
          同步状态
        </Button>
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

  useEffect(() => {
    setPreviewPlanKey(plan.current);
  }, [plan.current]);

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

function RecentOperationsTable({ operations }) {
  const columns = [
    {
      title: '操作',
      dataIndex: 'action',
      key: 'action',
      render: (action) => AUDIT_ACTION_META[action]?.label || '操作记录'
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      align: 'right',
      render: (dateStr) => dateStr ? new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z').toLocaleString('zh-CN', { hour12: false }) : '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const meta = {
          success: { label: '成功', color: 'success' },
          failed: { label: '失败', color: 'error' },
          pending: { label: '处理中', color: 'processing' }
        }[status] || { label: status, color: 'default' };
        return <Tag color={meta.color}>{meta.label}</Tag>;
      }
    },
    {
      title: '详情',
      dataIndex: 'details',
      key: 'details',
      render: (text) => text ? <Tooltip title={text}><span style={{maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'inline-block'}}>{text}</span></Tooltip> : '-'
    }
  ];

  return (
    <TablePanel title="最近操作记录">
      <Table
        dataSource={operations}
        columns={columns}
        rowKey="created_at"
        pagination={false}
        scroll={{ y: 200 }}
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
