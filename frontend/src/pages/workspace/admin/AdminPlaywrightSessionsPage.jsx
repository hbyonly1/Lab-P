import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Popconfirm, Space, Table, Tooltip, message } from 'antd';
import Editor from '@monaco-editor/react';
import {
  CloseCircleOutlined,
  DesktopOutlined,
  EyeOutlined,
  PoweroffOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { OutlineButton, PageHeading, StatCard, StatusBadge, TablePanel } from '../../../components/ui/index.js';
import {
  cancelAutomationJob,
  closeAllSchoolBrowserSessions,
  closeSchoolBrowserSession,
  getActiveAutomationJobs,
  getSchoolBrowserSessions,
  restartBackendService,
} from '../../../services/automationJobsApi.js';
import { getAutomationConfig, updateAutomationConfig } from '../../../services/automationConfigApi.js';
import { getApiErrorMessage } from '../../../utils/apiErrorUtils.js';

function formatDateTime(value) {
  if (!value) return '-';
  const raw = String(value);
  const date = new Date(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function formatDuration(fromValue) {
  if (!fromValue) return '-';
  const date = new Date(String(fromValue));
  if (Number.isNaN(date.getTime())) return '-';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

const SESSION_STATE_META = {
  report_list: { label: '列表页', tone: 'completed' },
  report_modal: { label: '报告弹窗', tone: 'processing' },
  bootbox_dialog: { label: '系统弹窗', tone: 'failed' },
  loading: { label: '加载中', tone: 'processing' },
  login_page: { label: '登录页', tone: 'failed' },
  closed: { label: '已关闭', tone: 'pending' },
  missing: { label: '不存在', tone: 'pending' },
  unknown: { label: '未知', tone: 'pending' },
};

const JOB_STATUS_META = {
  queued: { label: '排队中', tone: 'pending' },
  running: { label: '执行中', tone: 'processing' },
  retrying: { label: '重试中', tone: 'processing' },
  succeeded: { label: '已完成', tone: 'completed' },
  failed: { label: '失败', tone: 'failed' },
  cancelled: { label: '已取消', tone: 'pending' },
};

const JOB_ACTION_LABELS = {
  school_overview_sync: '刷新学校状态',
  school_detail_sync: '读取实验详情',
  school_report_screenshot: '查看提交截图',
  school_submission_screenshots: '查看所有截图',
  school_completion_check: '完整性检查',
  draft_submit: '临时提交',
  final_submit: '正式提交',
};

function sessionStateMeta(state) {
  return SESSION_STATE_META[state] || SESSION_STATE_META.unknown;
}

function jobStatusMeta(status) {
  return JOB_STATUS_META[status] || { label: status || '未知', tone: 'pending' };
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function DiagnosticModal({ open, session, onClose }) {
  const value = useMemo(() => JSON.stringify(session?.diagnostic || {}, null, 2), [session]);
  return (
    <Modal
      title="会话诊断"
      open={open}
      footer={null}
      width="min(920px, 94vw)"
      onCancel={onClose}
      destroyOnHidden
    >
      <Editor
        height="520px"
        language="json"
        theme="vs"
        value={value}
        loading="正在加载 JSON 编辑器..."
        options={{
          automaticLayout: true,
          readOnly: true,
          minimap: { enabled: false },
          fontSize: 13,
          wordWrap: 'on',
          scrollBeyondLastLine: false,
        }}
      />
    </Modal>
  );
}

export default function AdminPlaywrightSessionsPage() {
  const [sessions, setSessions] = useState([]);
  const [activeJobs, setActiveJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [configLoading, setConfigLoading] = useState(false);
  const [savingHeadless, setSavingHeadless] = useState(false);
  const [restartingBackend, setRestartingBackend] = useState(false);
  const [automationConfigRecord, setAutomationConfigRecord] = useState(null);
  const [diagnosticSession, setDiagnosticSession] = useState(null);

  const loadAutomationConfig = useCallback(async () => {
    setConfigLoading(true);
    try {
      const config = await getAutomationConfig();
      setAutomationConfigRecord(config);
      return config;
    } catch (error) {
      message.error(getApiErrorMessage(error, '加载自动化配置失败'));
      return null;
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSchoolBrowserSessions();
      setSessions(data || []);
    } catch (error) {
      message.error(getApiErrorMessage(error, '加载 Playwright 会话失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadActiveJobs = useCallback(async () => {
    setJobsLoading(true);
    try {
      const data = await getActiveAutomationJobs();
      setActiveJobs(data || []);
    } catch (error) {
      message.error(getApiErrorMessage(error, '加载活跃自动化任务失败'));
    } finally {
      setJobsLoading(false);
    }
  }, []);

  const refreshAll = useCallback(() => {
    loadActiveJobs();
    loadSessions();
  }, [loadActiveJobs, loadSessions]);

  useEffect(() => {
    refreshAll();
    loadAutomationConfig();
  }, [loadAutomationConfig, refreshAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      loadActiveJobs();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [loadActiveJobs]);

  const currentHeadless = automationConfigRecord?.config_json?.runtime?.headless === true;

  const metrics = useMemo(() => {
    const total = sessions.length;
    const active = sessions.filter((item) => item.pageClosed !== true && !['closed', 'missing'].includes(item.state)).length;
    const blocked = sessions.filter((item) => ['bootbox_dialog', 'login_page', 'unknown'].includes(item.state)).length;
    const runningJobs = activeJobs.length;
    return { total, active, blocked, runningJobs };
  }, [activeJobs.length, sessions]);

  const handleCloseSession = async (record) => {
    try {
      const result = await closeSchoolBrowserSession(record.userId);
      message.success(result.closed ? '会话已关闭' : '会话不存在或已关闭');
      loadSessions();
    } catch (error) {
      message.error(getApiErrorMessage(error, '关闭会话失败'));
    }
  };

  const handleCloseAll = async () => {
    try {
      const result = await closeAllSchoolBrowserSessions();
      message.success(`已关闭 ${result.closed || 0} 个会话`);
      loadSessions();
    } catch (error) {
      message.error(getApiErrorMessage(error, '关闭全部会话失败'));
    }
  };

  const handleCancelJob = async (record) => {
    try {
      await cancelAutomationJob(record.jobId);
      message.success('任务已终止');
      refreshAll();
    } catch (error) {
      message.error(getApiErrorMessage(error, '终止任务失败'));
    }
  };

  const handleCancelAllJobs = async () => {
    try {
      await Promise.all(activeJobs.map((job) => cancelAutomationJob(job.jobId)));
      message.success(`已终止 ${activeJobs.length} 个活跃任务`);
      refreshAll();
    } catch (error) {
      message.error(getApiErrorMessage(error, '终止全部任务失败'));
    }
  };

  const handleToggleHeadless = async () => {
    const latestConfig = automationConfigRecord || await loadAutomationConfig();
    if (!latestConfig?.config_json) return;
    const latestHeadless = latestConfig.config_json?.runtime?.headless === true;
    const nextHeadless = !latestHeadless;
    const nextConfigJson = {
      ...latestConfig.config_json,
      runtime: {
        ...(latestConfig.config_json.runtime || {}),
        headless: nextHeadless,
      },
    };
    setSavingHeadless(true);
    try {
      const saved = await updateAutomationConfig({
        name: latestConfig.name || 'default',
        schema_version: latestConfig.schema_version || '1.6',
        is_active: latestConfig.is_active ?? true,
        config_json: nextConfigJson,
      });
      setAutomationConfigRecord(saved);
      message.success(nextHeadless ? '已切换为 Headless，新会话生效' : '已切换为可视浏览器，新会话生效');
    } catch (error) {
      message.error(getApiErrorMessage(error, '切换 headless 失败'));
    } finally {
      setSavingHeadless(false);
    }
  };

  const handleRestartBackend = async () => {
    setRestartingBackend(true);
    const request = restartBackendService()
      .then(() => ({ status: 'ok' }))
      .catch((error) => ({ status: 'error', error }));
    try {
      const result = await Promise.race([
        request,
        delay(1500).then(() => ({ status: 'pending' })),
      ]);
      if (result.status === 'error' && result.error?.response) {
        message.error(getApiErrorMessage(result.error, '重启后端失败'));
        setRestartingBackend(false);
        return;
      }
      message.success('后端正在重启，约 10 秒后可继续操作');
      window.setTimeout(() => {
        setRestartingBackend(false);
      }, 12000);
    } catch (error) {
      message.error(getApiErrorMessage(error, '重启后端失败'));
      setRestartingBackend(false);
    }
  };

  const jobColumns = [
    {
      title: '任务',
      key: 'job',
      width: 220,
      render: (_, record) => (
        <div>
          <strong>{JOB_ACTION_LABELS[record.action] || record.action}</strong>
          <div style={{ color: '#6b7280', fontSize: 12 }}>{record.jobId}</div>
        </div>
      ),
    },
    {
      title: '目标学生',
      key: 'targetStudent',
      width: 170,
      render: (_, record) => (
        <div>
          <strong>{record.targetStudentNo || '-'}</strong>
          <div style={{ color: '#6b7280', fontSize: 12 }}>{record.targetRealName || '姓名未同步'}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const meta = jobStatusMeta(status);
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      },
    },
    {
      title: '当前步骤',
      key: 'message',
      width: 220,
      render: (_, record) => (
        <Tooltip title={record.messageCode || '-'}>
          <span>{record.messageCode || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '提交',
      dataIndex: 'submissionId',
      key: 'submissionId',
      width: 140,
      ellipsis: true,
    },
    {
      title: '实验',
      dataIndex: 'experimentId',
      key: 'experimentId',
      width: 180,
      ellipsis: true,
    },
    {
      title: '已运行',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 100,
      render: formatDuration,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      align: 'right',
      render: (_, record) => (
        <Popconfirm
          title="终止自动化任务"
          description={`确定终止任务 ${record.jobId} 吗？任务会标记为失败，后台轮询会停止。`}
          okText="终止"
          cancelText="取消"
          okButtonProps={{ danger: true }}
          onConfirm={() => handleCancelJob(record)}
        >
          <OutlineButton icon={<StopOutlined />} style={{ color: '#ff4d4f', borderColor: '#ffa39e' }}>
            终止
          </OutlineButton>
        </Popconfirm>
      ),
    },
  ];

  const sessionColumns = [
    {
      title: '学生',
      key: 'student',
      width: 180,
      render: (_, record) => (
        <div>
          <strong>{record.studentNo || `用户 ${record.userId}`}</strong>
          <div style={{ color: '#6b7280', fontSize: 12 }}>{record.realName || '姓名未同步'}</div>
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 120,
      render: (state) => {
        const meta = sessionStateMeta(state);
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      },
    },
    {
      title: '活跃任务',
      dataIndex: 'activeJobCount',
      key: 'activeJobCount',
      width: 100,
      render: (value) => value || 0,
    },
    {
      title: '来源',
      dataIndex: 'source',
      key: 'source',
      width: 150,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      key: 'url',
      ellipsis: true,
      render: (url) => (
        <Tooltip title={url || '-'}>
          <span>{url || '-'}</span>
        </Tooltip>
      ),
    },
    {
      title: '创建任务',
      dataIndex: 'createdByJobId',
      key: 'createdByJobId',
      width: 180,
      ellipsis: true,
    },
    {
      title: '已打开',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 100,
      render: formatDuration,
    },
    {
      title: '最后使用',
      dataIndex: 'lastUsedAt',
      key: 'lastUsedAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 190,
      align: 'right',
      render: (_, record) => (
        <Space>
          <OutlineButton icon={<EyeOutlined />} onClick={() => setDiagnosticSession(record)}>
            诊断
          </OutlineButton>
          <Popconfirm
            title="关闭 Playwright 会话"
            description={`确定关闭 ${record.studentNo || record.userId} 的学校系统浏览器会话吗？正在执行的自动化可能会失败。`}
            okText="关闭"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleCloseSession(record)}
          >
            <OutlineButton icon={<StopOutlined />} style={{ color: '#ff4d4f', borderColor: '#ffa39e' }}>
              关闭会话
            </OutlineButton>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <section className="workspace-standard-page">
      <PageHeading
        title="自动化任务"
        description="上方管理数据库中的自动化任务；下方管理后端内存里的 Playwright 浏览器会话。"
        actions={(
          <Space>
            <Popconfirm
              title="重启后端服务"
              description="确定重启 backend 吗？当前自动化会话会中断，正在执行的任务可能失败。"
              okText="重启"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleRestartBackend}
            >
              <OutlineButton
                icon={<PoweroffOutlined />}
                loading={restartingBackend}
                style={{ color: '#ff4d4f', borderColor: '#ffa39e' }}
              >
                重启后端
              </OutlineButton>
            </Popconfirm>
            <OutlineButton icon={<ReloadOutlined />} onClick={refreshAll} disabled={loading || jobsLoading}>
              刷新
            </OutlineButton>
          </Space>
        )}
      />

      <div className="ui-stat-grid">
        <StatCard icon={<DesktopOutlined />} label="浏览器会话" value={metrics.total} tone="blue" />
        <StatCard icon={<DesktopOutlined />} label="可复用会话" value={metrics.active} tone="green" />
        <StatCard icon={<CloseCircleOutlined />} label="异常会话" value={metrics.blocked} tone="amber" />
        <StatCard icon={<ReloadOutlined />} label="活跃任务" value={metrics.runningJobs} tone="violet" />
      </div>

      <TablePanel
        title="活跃自动化任务"
        actions={(
          <Space>
            <OutlineButton icon={<ReloadOutlined />} onClick={loadActiveJobs} disabled={jobsLoading}>
              刷新任务
            </OutlineButton>
            <Popconfirm
              title="终止全部活跃任务"
              description="确定终止全部活跃自动化任务吗？任务会标记为失败，后台轮询会停止。"
              okText="终止全部"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleCancelAllJobs}
              disabled={!activeJobs.length}
            >
              <OutlineButton
                icon={<StopOutlined />}
                disabled={!activeJobs.length}
                style={activeJobs.length ? { color: '#ff4d4f', borderColor: '#ffa39e' } : undefined}
              >
                终止全部任务
              </OutlineButton>
            </Popconfirm>
          </Space>
        )}
      >
        <Table
          loading={jobsLoading}
          columns={jobColumns}
          dataSource={activeJobs}
          rowKey="jobId"
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1360 }}
        />
      </TablePanel>

      <TablePanel
        title="Playwright 浏览器会话"
        actions={(
          <Space>
            <OutlineButton
              onClick={handleToggleHeadless}
              loading={savingHeadless || configLoading}
            >
              {currentHeadless ? '切换为可视' : '切换为 Headless'}
            </OutlineButton>
            <Popconfirm
              title="关闭全部浏览器会话"
              description="确定关闭全部学校系统 Playwright 浏览器会话吗？这只释放浏览器，不会自动终止数据库里的任务。"
              okText="关闭全部"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={handleCloseAll}
              disabled={!sessions.length}
            >
              <OutlineButton
                icon={<CloseCircleOutlined />}
                disabled={!sessions.length}
                style={sessions.length ? { color: '#ff4d4f', borderColor: '#ffa39e' } : undefined}
              >
                关闭全部会话
              </OutlineButton>
            </Popconfirm>
          </Space>
        )}
      >
        <Table
          loading={loading}
          columns={sessionColumns}
          dataSource={sessions}
          rowKey="userId"
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1200 }}
        />
      </TablePanel>

      <DiagnosticModal
        open={Boolean(diagnosticSession)}
        session={diagnosticSession}
        onClose={() => setDiagnosticSession(null)}
      />
    </section>
  );
}
