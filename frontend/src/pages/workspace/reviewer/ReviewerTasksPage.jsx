import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Table, Tooltip, Input, Select, Tag, Space, message } from 'antd';
import {
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  PictureOutlined,
  SendOutlined,
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

import { getReviewPool, approveSubmission } from '../../../services/submissionsApi.js';
import { triggerSubmissionRecognition } from '../../../services/aiApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';
import { ReviewBatchImageAssignmentModal } from '../../../components/reviewer/ReviewBatchImageAssignmentModal.jsx';

const { Option } = Select;

const resolveReviewStatus = (submissionStatus) => (
  REVIEW_COMPLETED_SUBMISSION_STATUSES.includes(submissionStatus) ? 'completed' : 'incomplete'
);

const PREPROCESS_TERMINAL_STATUSES = new Set(['done', 'failed', 'image_assignment_required']);

export default function ReviewerTasksPage() {
  const navigate = useNavigate();

  const [reviewTasks, setReviewTasks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [activeBatch, setActiveBatch] = useState(null);
  const preprocessWatchRef = useRef(new Map());
  const preprocessPollTimerRef = useRef(null);

  const fetchTasks = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const [data, allConfigs] = await Promise.all([
        getReviewPool(),
        experimentsApi.listExperiments(),
      ]);
      const configMap = {};
      allConfigs.forEach(c => { configMap[c.id] = c.name; });

      // Group by student + submission batch.
      const groups = {};
      data.forEach(sub => {
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
        return g;
      });

      setReviewTasks(formattedTasks);
    } catch (error) {
      message.error('无法获取审核任务列表');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

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
      const data = await getReviewPool();
      const latestById = new Map(data.map((item) => [item.id, item]));
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

  const [searchText, setSearchText] = useState('');
  const [reviewStatusFilter, setReviewStatusFilter] = useState('');
  const [expStatusFilter, setExpStatusFilter] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  // Filter Data
  const filteredData = reviewTasks.reduce((acc, item) => {
    const matchSearch = item.student_id.includes(searchText) || item.name.includes(searchText);
    const matchReview = reviewStatusFilter ? item.review_status === reviewStatusFilter : true;

    if (matchSearch && matchReview) {
      if (expStatusFilter || reviewStatusFilter === 'incomplete') {
        const matchingExps = item.experiments.filter(exp => {
          const matchExpStatus = expStatusFilter ? exp.status === expStatusFilter : true;
          const matchExpReview = reviewStatusFilter === 'incomplete' ? exp.review_status === reviewStatusFilter : true;
          return matchExpStatus && matchExpReview;
        });
        if (matchingExps.length > 0) {
          acc.push({ ...item, experiments: matchingExps });
        }
      } else {
        acc.push(item);
      }
    }
    return acc;
  }, []);

  useEffect(() => {
    if (expStatusFilter || reviewStatusFilter) {
      setExpandedRowKeys(filteredData.map(item => item.row_key));
    } else {
      // Optional: Collapse all when filter is cleared, or leave as is. We'll collapse.
      setExpandedRowKeys([]);
    }
  }, [expStatusFilter, reviewStatusFilter]); // We specifically only want to trigger this when the filter itself changes.

  const handleActionClick = async (action, exp) => {
    if (action === 'submit') {
      try {
        await approveSubmission(exp.submission_id);
        message.success('已提交流程');
        fetchTasks();
      } catch (e) {
        message.error('提交失败：' + (e.response?.data?.detail || e.message));
      }
    } else if (action === 'recognize') {
      try {
        message.loading({ content: '正在触发识别任务...', key: 'recognize' });
        await triggerSubmissionRecognition(exp.submission_id);
        message.success({ content: '识别任务已触发，请稍后刷新查看进度。', key: 'recognize' });
        fetchTasks();
      } catch (e) {
        message.error({ content: '触发识别失败：' + (e.response?.data?.detail || e.message), key: 'recognize' });
      }
    } else {
      navigate(`/workspace/reviewer/tasks/${exp.submission_id}?exp=${exp.id}`);
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
        render: (_, exp) => `${exp.assigned_image_count || 0}/${exp.image_count || 0}`,
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
            <Tooltip title="提交">
              <OutlineButton icon={<SendOutlined />} onClick={() => handleActionClick('submit', exp)} />
            </Tooltip>
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
      title: '批次',
      dataIndex: 'batch_id',
      key: 'batch_id',
      render: (batchId) => <Tag color="blue">{batchId}</Tag>
    },
    {
      title: '图片',
      key: 'images',
      align: 'center',
      render: (_, record) => `${record.assigned_image_count || 0}/${record.image_count || 0}`
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
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              placeholder="审核状态筛选"
              style={{ width: 140 }}
              allowClear
              value={reviewStatusFilter}
              onChange={setReviewStatusFilter}
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
              onChange={setExpStatusFilter}
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
            onExpandedRowsChange: setExpandedRowKeys,
          }}
          dataSource={filteredData}
          rowKey="row_key"
          pagination={{ pageSize: 10 }}
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
