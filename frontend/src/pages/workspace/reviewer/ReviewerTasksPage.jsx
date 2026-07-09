import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Table, Tooltip, Input, Select, Tag, Space, message } from 'antd';
import {
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  PictureOutlined,
  SearchOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PageHeading, TablePanel, OutlineButton, StatusBadge } from '../../../components/ui/index.js';
import {
  STATUS_META,
  STATUS_LIST,
  REVIEW_STATUS_LIST,
  REVIEW_STATUS_META,
  REVIEW_COMPLETED_SUBMISSION_STATUSES,
} from '../../../constants/statusEnums.js';

import { getReviewPool } from '../../../services/submissionsApi.js';
import { triggerSubmissionRecognition } from '../../../services/aiApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import { ReviewBatchImageAssignmentModal } from '../../../components/reviewer/ReviewBatchImageAssignmentModal.jsx';
import { readReviewerTasksListState, writeReviewerTasksListState } from '../../../utils/reviewerTasksListState.js';

const { Option } = Select;

const resolveReviewStatus = (submissionStatus) => (
  REVIEW_COMPLETED_SUBMISSION_STATUSES.includes(submissionStatus) ? 'completed' : 'incomplete'
);

const PREPROCESS_TERMINAL_STATUSES = new Set(['done', 'failed', 'image_assignment_required']);
const PREPROCESS_COMPLETED_SUBMISSION_STATUSES = new Set(['reviewing', 'draft_submitted', 'completed']);
const PREPROCESS_PROCESSING_SUBMISSION_STATUSES = new Set(['preparing_review', 'recognizing']);
const PREPROCESS_FAILED_SUBMISSION_STATUSES = new Set(['error']);

const PREPROCESS_STATUS_META = {
  completed: { label: '已完成', tone: 'completed' },
  processing: { label: '已进入AI识别', tone: 'processing' },
  pending: { label: '待处理', tone: 'pending' },
  failed: { label: '失败', tone: 'failed' },
};

const hasEnteredAiPreprocess = (exp) => (
  exp?.preprocess_status === 'queued'
  || exp?.preprocess_status === 'running'
  || PREPROCESS_PROCESSING_SUBMISSION_STATUSES.has(exp?.status)
);

function resolvePreprocessState(exp) {
  const preprocessStatus = exp.preprocess_status;
  const submissionStatus = exp.status;

  if (preprocessStatus === 'done' || PREPROCESS_COMPLETED_SUBMISSION_STATUSES.has(submissionStatus)) {
    return 'completed';
  }
  if (preprocessStatus === 'failed' || PREPROCESS_FAILED_SUBMISSION_STATUSES.has(submissionStatus)) {
    return 'failed';
  }
  if (preprocessStatus === 'queued' || preprocessStatus === 'running' || PREPROCESS_PROCESSING_SUBMISSION_STATUSES.has(submissionStatus)) {
    return 'processing';
  }
  return 'pending';
}

function resolvePreprocessSummary(experiments = []) {
  const total = experiments.length;
  const counts = { completed: 0, processing: 0, pending: 0, failed: 0 };
  experiments.forEach((exp) => {
    counts[resolvePreprocessState(exp)] += 1;
  });

  let state = 'pending';
  if (total > 0 && counts.completed === total) {
    state = 'completed';
  } else if (counts.failed > 0) {
    state = 'failed';
  } else if (counts.processing > 0) {
    state = 'processing';
  }

  const numerator = state === 'completed' ? counts.completed : counts[state];
  return { state, count: numerator, total };
}

export default function ReviewerTasksPage() {
  const navigate = useNavigate();
  const restoredListStateRef = useRef(readReviewerTasksListState());
  const initialListState = restoredListStateRef.current || {};

  const [reviewTasks, setReviewTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeBatch, setActiveBatch] = useState(null);
  const [searchText, setSearchText] = useState(initialListState.searchText || '');
  const [reviewStatusFilter, setReviewStatusFilter] = useState(initialListState.reviewStatusFilter || '');
  const [expStatusFilter, setExpStatusFilter] = useState(initialListState.expStatusFilter || '');
  const [expandedRowKeys, setExpandedRowKeys] = useState(initialListState.expandedRowKeys || []);
  const [pagination, setPagination] = useState(initialListState.pagination || { current: 1, pageSize: 10 });
  const [taskTotal, setTaskTotal] = useState(0);
  const restoredScrollYRef = useRef(Number(initialListState.scrollY || 0));
  const didRestoreScrollRef = useRef(false);
  const didMountStateSaverRef = useRef(false);
  const skipNextFilterExpansionRef = useRef(Boolean(restoredListStateRef.current));
  const listStateRef = useRef({
    searchText: initialListState.searchText || '',
    reviewStatusFilter: initialListState.reviewStatusFilter || '',
    expStatusFilter: initialListState.expStatusFilter || '',
    expandedRowKeys: initialListState.expandedRowKeys || [],
    pagination: initialListState.pagination || { current: 1, pageSize: 10 },
    scrollY: Number(initialListState.scrollY || 0),
  });
  const preprocessWatchRef = useRef(new Map());
  const preprocessPollTimerRef = useRef(null);

  const saveListState = useCallback((overrides = {}) => {
    const nextState = {
      ...listStateRef.current,
      searchText,
      reviewStatusFilter,
      expStatusFilter,
      expandedRowKeys,
      pagination,
      scrollY: window.scrollY || listStateRef.current.scrollY || 0,
      ...overrides,
    };
    listStateRef.current = nextState;
    restoredScrollYRef.current = Number(nextState.scrollY || 0);
    writeReviewerTasksListState(nextState);
  }, [expStatusFilter, expandedRowKeys, pagination, reviewStatusFilter, searchText]);

  const fetchTasks = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [data, allConfigs] = await Promise.all([
        getReviewPool({
          page: pagination.current || 1,
          pageSize: pagination.pageSize || 10,
          query: searchText.trim() || undefined,
          status: expStatusFilter || undefined,
          reviewStatus: reviewStatusFilter || undefined,
        }),
        experimentsApi.listExperiments(),
      ]);
      const submissionRows = data.items || [];
      setTaskTotal(data.total || 0);
      const configMap = {};
      allConfigs.forEach(c => { configMap[c.id] = c.name; });

      // Group by student + submission batch.
      const groups = {};
      submissionRows.forEach(sub => {
        const batchId = sub.submission_batch_id || `LEGACY-${sub.student_username}`;
        const groupKey = `${sub.student_username}-${batchId}`;
        if (!groups[groupKey]) {
          groups[groupKey] = {
            row_key: groupKey,
            batch_id: batchId,
            student_id: String(sub.student_username), // UI labels it "student_id" but actually shows username
            name: sub.student_name || '姓名未同步',
            review_status: 'incomplete', // default, evaluate below
            image_count: 0,
            assigned_image_count: 0,
            experiments: []
          };
        }
        groups[groupKey].image_count += sub.image_count || 0;
        groups[groupKey].assigned_image_count += sub.assigned_image_count || 0;
        groups[groupKey].experiments.push({
          id: sub.experiment_id,
          submission_id: sub.id,
          name: configMap[sub.experiment_id] || sub.experiment_id,
          status: sub.status,
          review_status: resolveReviewStatus(sub.status),
          batch_id: batchId,
          image_count: sub.image_count || 0,
          assigned_image_count: sub.assigned_image_count || 0,
          preprocess_status: sub.preprocess_status,
          preprocess_error: sub.preprocess_error,
          updated_at: sub.updated_at ? new Date(sub.updated_at.endsWith('Z') ? sub.updated_at : sub.updated_at + 'Z').toLocaleString() : '-',
          submitted_by: sub.submitted_by,
          student_id: sub.student_username
        });
      });

      // Evaluate review_status at batch level.
      const formattedTasks = Object.values(groups).map(g => {
        const allReviewed = g.experiments.length > 0 && g.experiments.every(e => e.review_status === 'completed');
        g.review_status = allReviewed ? 'completed' : 'incomplete';
        g.experiment_count = g.experiments.length;
        g.preprocess_summary = resolvePreprocessSummary(g.experiments);
        return g;
      });

      const focusedSubmissionId = listStateRef.current.focusSubmissionId;
      if (focusedSubmissionId) {
        const focusedGroup = formattedTasks.find(group => (
          (group.experiments || []).some(exp => exp.submission_id === focusedSubmissionId)
        ));
        if (focusedGroup && !listStateRef.current.expandedRowKeys?.includes(focusedGroup.row_key)) {
          const nextExpandedRowKeys = [
            ...(listStateRef.current.expandedRowKeys || []),
            focusedGroup.row_key,
          ];
          listStateRef.current = {
            ...listStateRef.current,
            expandedRowKeys: nextExpandedRowKeys,
          };
          setExpandedRowKeys(nextExpandedRowKeys);
        }
      }

      setReviewTasks(formattedTasks);
    } catch (error) {
      message.error('无法获取审核任务列表');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [expStatusFilter, pagination.current, pagination.pageSize, reviewStatusFilter, searchText]);

  const stopPreprocessPolling = useCallback(() => {
    if (preprocessPollTimerRef.current) {
      window.clearInterval(preprocessPollTimerRef.current);
      preprocessPollTimerRef.current = null;
    }
  }, []);

  const pollPreprocessCompletions = useCallback(async () => {
    const watched = preprocessWatchRef.current;
    if (!watched.size) {
      stopPreprocessPolling();
      return;
    }

    try {
      const data = await getReviewPool({ page: 1, pageSize: 100 });
      const submissionRows = data.items || [];
      const latestById = new Map(submissionRows.map((item) => [item.id, item]));
      let hasTerminalChange = false;

      watched.forEach((tracked, submissionId) => {
        const latest = latestById.get(submissionId);
        const status = latest?.preprocess_status;
        if (!status) return;

        if (status === 'done') {
          message.success(`${tracked.studentName}的${tracked.experimentName} AI预处理已完成`);
          watched.delete(submissionId);
          hasTerminalChange = true;
          return;
        }

        if (status === 'failed' || status === 'image_assignment_required') {
          const errorText = latest?.preprocess_error ? `：${latest.preprocess_error}` : '';
          message.error(`${tracked.studentName}的${tracked.experimentName} AI预处理失败${errorText}`);
          watched.delete(submissionId);
          hasTerminalChange = true;
          return;
        }

        if (PREPROCESS_TERMINAL_STATUSES.has(status)) {
          watched.delete(submissionId);
          hasTerminalChange = true;
        }
      });

      if (hasTerminalChange) {
        fetchTasks({ silent: true });
      }
      if (!watched.size) {
        stopPreprocessPolling();
      }
    } catch (error) {
      // Keep polling; transient refresh failures should not drop completion notifications.
    }
  }, [fetchTasks, stopPreprocessPolling]);

  const ensurePreprocessPolling = useCallback(() => {
    if (preprocessPollTimerRef.current) return;
    preprocessPollTimerRef.current = window.setInterval(pollPreprocessCompletions, 3000);
  }, [pollPreprocessCompletions]);

  const handlePrepareStarted = useCallback(({ batch, submissionIds = [] }) => {
    const startedIds = new Set(submissionIds);
    const experiments = batch?.experiments || [];
    const trackedExperiments = experiments.filter((exp) => (
      startedIds.size ? startedIds.has(exp.submission_id) : true
    ));

    trackedExperiments.forEach((exp) => {
      preprocessWatchRef.current.set(exp.submission_id, {
        studentName: batch?.name || batch?.student_id || '该学生',
        experimentName: exp.name || exp.id || '该实验',
      });
    });

    if (trackedExperiments.length) {
      ensurePreprocessPolling();
      pollPreprocessCompletions();
    }
  }, [ensurePreprocessPolling, pollPreprocessCompletions]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => () => stopPreprocessPolling(), [stopPreprocessPolling]);

  // Metrics calculation
  const allExperiments = reviewTasks.flatMap(task => task.experiments);
  const total = allExperiments.length;
  const pending = allExperiments.filter(item => item.review_status !== 'completed').length;
  const reviewing = allExperiments.filter(item => item.status === 'reviewing').length;
  const completed = allExperiments.filter(item => item.review_status === 'completed').length;

  const filteredData = reviewTasks;

  useEffect(() => {
    if (skipNextFilterExpansionRef.current) {
      skipNextFilterExpansionRef.current = false;
      return;
    }
    if (expStatusFilter || reviewStatusFilter) {
      setExpandedRowKeys(reviewTasks.map(item => item.row_key));
      return;
    }
    setExpandedRowKeys([]);
    // Only react to filter changes. Reacting to reviewTasks refresh collapses restored rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expStatusFilter, reviewStatusFilter]);

  useEffect(() => {
    if (!didMountStateSaverRef.current) {
      didMountStateSaverRef.current = true;
      return;
    }
    saveListState();
  }, [saveListState]);

  useEffect(() => {
    if (didRestoreScrollRef.current || loading || reviewTasks.length === 0) return;
    didRestoreScrollRef.current = true;
    const scrollY = restoredScrollYRef.current;
    if (!scrollY) return;
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    });
  }, [loading, reviewTasks.length]);

  const handleActionClick = async (action, exp) => {
    if (action === 'recognize') {
      try {
        message.loading({ content: '正在触发识别任务...', key: 'recognize' });
        await triggerSubmissionRecognition(exp.submission_id);
        message.success({ content: '识别任务已触发，请稍后刷新查看进度。', key: 'recognize' });
        fetchTasks();
      } catch (e) {
        message.error({ content: '触发识别失败：' + (e.response?.data?.detail || e.message), key: 'recognize' });
      }
    } else {
      const parentRowKey = exp.student_id && exp.batch_id ? `${exp.student_id}-${exp.batch_id}` : null;
      const nextExpandedRowKeys = parentRowKey
        ? Array.from(new Set([...(expandedRowKeys || []), parentRowKey]))
        : expandedRowKeys;
      saveListState({
        expandedRowKeys: nextExpandedRowKeys,
        focusSubmissionId: exp.submission_id,
        focusExperimentId: exp.id,
        scrollY: window.scrollY || 0,
      });
      navigate(`/workspace/reviewer/tasks/${exp.submission_id}?exp=${exp.id}&from=reviewer-tasks`);
    }
  };

  const expandedRowRender = (record) => {
    const columns = [
      {
        title: '实验名称',
        dataIndex: 'name',
        key: 'name',
        render: (text, record) => (
          <Space>
            {text}
            {record.submitted_by && String(record.submitted_by) !== String(record.student_id) && (
              <Tag color="orange">管理员代交</Tag>
            )}
          </Space>
        )
      },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        align: 'center',
        render: (status) => {
          const meta = STATUS_META[status] ?? STATUS_META.not_started;
          return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
        }
      },
      {
        title: '审核状态',
        dataIndex: 'review_status',
        key: 'review_status',
        align: 'center',
        render: (status) => {
          const meta = REVIEW_STATUS_META[status] ?? REVIEW_STATUS_META.incomplete;
          return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
        }
      },
      {
        title: '图片匹配',
        key: 'images',
        align: 'center',
        render: (_, exp) => {
          if (hasEnteredAiPreprocess(exp)) {
            return <StatusBadge tone="processing">已进入AI识别</StatusBadge>;
          }
          if (exp.preprocess_status === 'done' || PREPROCESS_COMPLETED_SUBMISSION_STATUSES.has(exp.status)) {
            return <StatusBadge tone="completed">已完成</StatusBadge>;
          }
          return `${exp.assigned_image_count || 0}/${exp.image_count || 0}`;
        },
      },
      { title: '最后更新', dataIndex: 'updated_at', key: 'updated_at' },
      {
        title: '操作',
        key: 'actions',
        align: 'right',
        render: (_, exp) => (
          <div className="recent-task-actions" style={{ justifyContent: 'flex-end' }}>
            <Tooltip title="编辑">
              <OutlineButton icon={<EditOutlined />} onClick={() => handleActionClick('edit', exp)} />
            </Tooltip>
            {exp.status === 'pending_recognition' && (
              <Tooltip title="识别">
                <OutlineButton icon={<RobotOutlined />} onClick={() => handleActionClick('recognize', exp)} />
              </Tooltip>
            )}
          </div>
        )
      },
    ];

    return (
      <Table
        columns={columns}
        dataSource={record.experiments}
        pagination={false}
        rowKey="id"
        size="small"
      />
    );
  };

  const parentColumns = [
    {
      title: '学号',
      dataIndex: 'student_id',
      key: 'student_id'
    },
    {
      title: '姓名',
      dataIndex: 'name',
      key: 'name'
    },
    {
      title: '提交组',
      dataIndex: 'batch_id',
      key: 'batch_id',
      render: (batchId, record) => {
        const count = record.experiment_count || record.experiments?.length || 0;
        const label = count <= 1 ? '单实验' : `批量 ${count} 个`;
        return (
          <Tooltip title={batchId}>
            <Tag color={count <= 1 ? 'default' : 'blue'}>{label}</Tag>
          </Tooltip>
        );
      }
    },
    {
      title: '图片',
      key: 'images',
      align: 'center',
      render: (_, record) => {
        const experiments = record.experiments || [];
        const enteredCount = experiments.filter(hasEnteredAiPreprocess).length;
        if (enteredCount > 0) {
          return (
            <StatusBadge tone="processing">
              已进入AI识别 {enteredCount}/{experiments.length}
            </StatusBadge>
          );
        }
        return `${record.assigned_image_count || 0}/${record.image_count || 0}`;
      }
    },
    {
      title: '预处理状态',
      dataIndex: 'preprocess_summary',
      key: 'preprocess_summary',
      align: 'center',
      render: (summary) => {
        const safeSummary = summary || { state: 'pending', count: 0, total: 0 };
        const meta = PREPROCESS_STATUS_META[safeSummary.state] ?? PREPROCESS_STATUS_META.pending;
        return (
          <StatusBadge tone={meta.tone}>
            {meta.label} {safeSummary.count}/{safeSummary.total}
          </StatusBadge>
        );
      }
    },
    {
      title: '审核状态',
      dataIndex: 'review_status',
      key: 'review_status',
      render: (status) => {
        const meta = REVIEW_STATUS_META[status] ?? REVIEW_STATUS_META.incomplete;
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      }
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, record) => (
        <Tooltip title="图片匹配 / 批量预处理">
          <OutlineButton icon={<PictureOutlined />} onClick={() => setActiveBatch(record)} />
        </Tooltip>
      )
    }
  ];

  return (
    <section className="workspace-standard-page reviewer-tasks-page">
      <PageHeading title="审核任务" description="对照图片审核识别结果，补充固定填空和实验问题。" />

      <aside className="student-dashboard-main-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <article className="dashboard-metric-card is-blue">
          <span className="metric-icon"><AuditOutlined /></span>
          <div>
            <span className="metric-label-row"><span>全部审核任务</span></span>
            <strong>{total}</strong>
          </div>
        </article>
        <article className="dashboard-metric-card is-amber">
          <span className="metric-icon"><ClockCircleOutlined /></span>
          <div>
            <span className="metric-label-row"><span>审核未完成</span></span>
            <strong>{pending}</strong>
          </div>
        </article>
        <article className="dashboard-metric-card is-green">
          <span className="metric-icon"><EditOutlined /></span>
          <div>
            <span className="metric-label-row"><span>人工审核中</span></span>
            <strong>{reviewing}</strong>
          </div>
        </article>
        <article className="dashboard-metric-card is-violet">
          <span className="metric-icon"><CheckCircleOutlined /></span>
          <div>
            <span className="metric-label-row"><span>审核完成</span></span>
            <strong>{completed}</strong>
          </div>
        </article>
      </aside>

      <TablePanel
        title="提交列表"
        actions={
          <Space>
            <Input
              placeholder="搜索学号 / 姓名"
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={e => {
                setSearchText(e.target.value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
              style={{ width: 200 }}
            />
            <Select
              placeholder="审核状态筛选"
              style={{ width: 140 }}
              allowClear
              value={reviewStatusFilter}
              onChange={(value) => {
                setReviewStatusFilter(value || '');
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            >
              {REVIEW_STATUS_LIST.map(key => (
                <Option key={key} value={key}>{REVIEW_STATUS_META[key].label}</Option>
              ))}
            </Select>
            <Select
              placeholder="实验状态筛选"
              style={{ width: 140 }}
              allowClear
              value={expStatusFilter}
              onChange={(value) => {
                setExpStatusFilter(value || '');
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            >
              {STATUS_LIST.map(key => (
                <Option key={key} value={key}>{STATUS_META[key].label}</Option>
              ))}
            </Select>
          </Space>
        }
      >
        <Table
          className="reviewer-tasks-table"
          loading={loading}
          columns={parentColumns}
          expandable={{
            expandedRowRender,
            expandedRowKeys,
            onExpandedRowsChange: (nextKeys) => {
              const keys = Array.from(nextKeys);
              setExpandedRowKeys(keys);
              saveListState({ expandedRowKeys: keys, scrollY: window.scrollY || 0 });
            },
          }}
          dataSource={filteredData}
          rowKey="row_key"
          pagination={{
            ...pagination,
            total: taskTotal,
            showSizeChanger: false,
          }}
          onChange={(nextPagination) => {
            const nextState = {
              current: nextPagination.current || 1,
              pageSize: nextPagination.pageSize || pagination.pageSize || 10,
            };
            setPagination(nextState);
            saveListState({ pagination: nextState, scrollY: window.scrollY || 0 });
          }}
        />
      </TablePanel>
      <ReviewBatchImageAssignmentModal
        open={Boolean(activeBatch)}
        batch={activeBatch}
        onClose={() => setActiveBatch(null)}
        onFinished={fetchTasks}
        onPrepareStarted={handlePrepareStarted}
      />
    </section>
  );
}
