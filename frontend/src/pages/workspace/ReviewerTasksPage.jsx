import React, { useState, useEffect } from 'react';
import { Table, Tooltip, Input, Select, Space, message } from 'antd';
import {
  AuditOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  EyeOutlined,
  FileDoneOutlined,
  SendOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { PageHeading, TablePanel, OutlineButton, StatusBadge } from '../../components/ui/index.js';
import { STATUS_META, STATUS_LIST, OVERALL_STATUS_LIST, OVERALL_STATUS_META } from '../../constants/statusEnums.js';

const { Option } = Select;

// Mock Data
const mockReviewTasks = [
  {
    student_id: '20230001',
    name: '张三',
    overall_status: 'incomplete',
    experiments: [
      { id: 'exp-001', name: '光学实验报告', status: 'reviewing', updated_at: '2 小时前' },
      { id: 'exp-002', name: '电路分析实验', status: 'completed', updated_at: '1 天前' }
    ]
  },
  {
    student_id: '20230002',
    name: '李四',
    overall_status: 'incomplete',
    experiments: [
      { id: 'exp-003', name: '化学反应实验', status: 'not_started', updated_at: '2 天前' },
      { id: 'exp-004', name: '物理力学实验', status: 'incomplete', updated_at: '3 天前' }
    ]
  },
  {
    student_id: '20230003',
    name: '王五',
    overall_status: 'completed',
    experiments: [
      { id: 'exp-001', name: '光学实验报告', status: 'completed', updated_at: '1 天前' }
    ]
  }
];

export default function ReviewerTasksPage() {
  const navigate = useNavigate();

  // Metrics calculation
  const allExperiments = mockReviewTasks.flatMap(task => task.experiments);
  const total = allExperiments.length;
  const pending = allExperiments.filter(item => ['not_started', 'incomplete'].includes(item.status)).length;
  const reviewing = allExperiments.filter(item => item.status === 'reviewing').length;
  const completed = allExperiments.filter(item => item.status === 'completed').length;

  const [searchText, setSearchText] = useState('');
  const [overallStatusFilter, setOverallStatusFilter] = useState('');
  const [expStatusFilter, setExpStatusFilter] = useState('');
  const [expandedRowKeys, setExpandedRowKeys] = useState([]);

  // Filter Data
  const filteredData = mockReviewTasks.reduce((acc, item) => {
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

  const handleActionClick = (action, expId) => {
    if (action === 'submit') {
      message.success('已提交流程');
    } else {
      navigate(`/workspace/student/experiments/${expId}`);
    }
  };

  const expandedRowRender = (record) => {
    const columns = [
      { title: '实验名称', dataIndex: 'name', key: 'name' },
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
              <OutlineButton icon={<EyeOutlined />} onClick={() => handleActionClick('view', exp.id)} />
            </Tooltip>
            <Tooltip title="编辑">
              <OutlineButton icon={<EditOutlined />} onClick={() => handleActionClick('edit', exp.id)} />
            </Tooltip>
            <Tooltip title="提交">
              <OutlineButton icon={<SendOutlined />} onClick={() => handleActionClick('submit', exp.id)} />
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

      <aside className="student-dashboard-main-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
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
