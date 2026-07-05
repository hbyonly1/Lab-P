import React, { useState, useEffect } from 'react';
import { Table, Tooltip, Input, Select, Tag, Space, message } from 'antd';
import {
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EyeOutlined,
  FileDoneOutlined,
  SendOutlined,
  SearchOutlined,
  RobotOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PageHeading, TablePanel, OutlineButton, StatusBadge } from '../../../components/ui/index.js';
import { STATUS_META, STATUS_LIST, OVERALL_STATUS_LIST, OVERALL_STATUS_META } from '../../../constants/statusEnums.js';

import { getReviewPool, approveSubmission } from '../../../services/submissionsApi.js';
import { triggerSubmissionRecognition } from '../../../services/aiApi.js';
import { experimentsApi } from '../../../services/experimentsApi.js';

const { Option } = Select;

export default function ReviewerTasksPage() {
  const navigate = useNavigate();

  const [reviewTasks, setReviewTasks] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const [data, allConfigs] = await Promise.all([
        getReviewPool(),
        experimentsApi.listExperiments(),
      ]);
      const configMap = {};
      allConfigs.forEach(c => { configMap[c.id] = c.name; });

      // Group by student_username
      const groups = {};
      data.forEach(sub => {
        if (!groups[sub.student_username]) {
          groups[sub.student_username] = {
            student_id: String(sub.student_username), // UI labels it "student_id" but actually shows username
            name: sub.student_name || '姓名未同步',
            overall_status: 'incomplete', // default, evaluate below
            experiments: []
          };
        }
        groups[sub.student_username].experiments.push({
          id: sub.experiment_id,
          submission_id: sub.id,
          name: configMap[sub.experiment_id] || sub.experiment_id,
          status: sub.status,
          updated_at: sub.updated_at ? new Date(sub.updated_at.endsWith('Z') ? sub.updated_at : sub.updated_at + 'Z').toLocaleString() : '-',
          submitted_by: sub.submitted_by,
          student_id: sub.student_username
        });
      });

      // Evaluate overall_status
      const formattedTasks = Object.values(groups).map(g => {
        const allCompleted = g.experiments.every(e => e.status === 'completed');
        g.overall_status = allCompleted ? 'completed' : 'incomplete';
        return g;
      });

      setReviewTasks(formattedTasks);
    } catch (error) {
      message.error('无法获取审核任务列表');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  // Metrics calculation
  const allExperiments = reviewTasks.flatMap(task => task.experiments);
  const total = allExperiments.length;
  const pending = allExperiments.filter(item => ['not_started', 'incomplete', 'recognizing'].includes(item.status)).length;
  const reviewing = allExperiments.filter(item => item.status === 'reviewing').length;
  const completed = allExperiments.filter(item => item.status === 'completed').length;

  const [searchText, setSearchText] = useState('');
  const [overallStatusFilter, setOverallStatusFilter] = useState('');
  const [expStatusFilter, setExpStatusFilter] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  // Filter Data
  const filteredData = reviewTasks.reduce((acc, item) => {
    const matchSearch = item.student_id.includes(searchText) || item.name.includes(searchText);
    const matchOverall = overallStatusFilter ? item.overall_status === overallStatusFilter : true;

    if (matchSearch && matchOverall) {
      if (expStatusFilter) {
        const matchingExps = item.experiments.filter(exp => exp.status === expStatusFilter);
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
    if (expStatusFilter) {
      setExpandedRowKeys(filteredData.map(item => item.student_id));
    } else {
      // Optional: Collapse all when filter is cleared, or leave as is. We'll collapse.
      setExpandedRowKeys([]);
    }
  }, [expStatusFilter]); // We specifically only want to trigger this when the filter itself changes.

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
      { title: '最后更新', dataIndex: 'updated_at', key: 'updated_at' },
      {
        title: '操作',
        key: 'actions',
        align: 'right',
        render: (_, exp) => (
          <div className="recent-task-actions" style={{ justifyContent: 'flex-end' }}>
            <Tooltip title="在系统里查看">
              <OutlineButton icon={<EyeOutlined />} onClick={() => handleActionClick('view', exp)} />
            </Tooltip>
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
      title: '总进度',
      dataIndex: 'overall_status',
      key: 'overall_status',
      render: (status) => {
        const meta = OVERALL_STATUS_META[status] ?? OVERALL_STATUS_META.incomplete;
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      }
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
            <span className="metric-label-row"><span>未完成</span></span>
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
            <span className="metric-label-row"><span>已完成</span></span>
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
              placeholder="总进度筛选"
              style={{ width: 140 }}
              allowClear
              value={overallStatusFilter}
              onChange={setOverallStatusFilter}
            >
              {OVERALL_STATUS_LIST.map(key => (
                <Option key={key} value={key}>{OVERALL_STATUS_META[key].label}</Option>
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
          rowKey="student_id"
          pagination={{ pageSize: 10 }}
        />
      </TablePanel>
    </section>
  );
}
