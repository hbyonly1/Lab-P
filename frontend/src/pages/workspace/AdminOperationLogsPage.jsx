import React, { useState } from 'react';
import { Table, Input, Select, Space, Modal, Tooltip, Typography } from 'antd';
import {
  FileDoneOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { PageHeading, TablePanel, OutlineButton, StatusBadge } from '../../components/ui/index.js';
import { 
  AUDIT_ACTION_META, 
  AUDIT_ACTION_LIST, 
  AUDIT_STATUS_META, 
  AUDIT_STATUS_LIST 
} from '../../constants/auditEnums.js';

const { Option } = Select;
const { Paragraph, Text } = Typography;

// Mock Data
const mockOperationLogs = [
  {
    id: 'log-001',
    action: 'upload_image',
    initiator_id: '20230001',
    initiator_name: '张三 (Student)',
    status: 'success',
    created_at: '2023-10-25 10:00:00',
    parameters: { file_name: 'exp_01_page1.jpg', size: '2MB', experiment_id: 'exp-001' },
    error_stack: null
  },
  {
    id: 'log-002',
    action: 'ai_recognize',
    initiator_id: 'system',
    initiator_name: 'System',
    status: 'success',
    created_at: '2023-10-25 10:01:00',
    parameters: { model: 'gemini-1.5-pro', token_usage: 1200 },
    error_stack: null
  },
  {
    id: 'log-003',
    action: 'calculate_data',
    initiator_id: 'system',
    initiator_name: 'System',
    status: 'failed',
    created_at: '2023-10-25 10:02:00',
    parameters: { formula: 'v = s / t', inputs: { s: 100, t: 0 } },
    error_stack: 'ZeroDivisionError: division by zero\n  at calculate (/workers/calc.py:45)'
  },
  {
    id: 'log-004',
    action: 'manual_review',
    initiator_id: 'admin_01',
    initiator_name: '李老师 (Admin)',
    status: 'success',
    created_at: '2023-10-25 11:30:00',
    parameters: { target_submission: 'sub_1001', overrides: { 'field_3': '5.01' } },
    error_stack: null
  },
  {
    id: 'log-005',
    action: 'auto_fill',
    initiator_id: '20230002',
    initiator_name: '李四 (Student)',
    status: 'pending',
    created_at: '2023-10-25 14:00:00',
    parameters: { school_system_url: 'http://lab.school.edu', mode: 'headless' },
    error_stack: null
  },
  {
    id: 'log-006',
    action: 'generate_ai_answer',
    initiator_id: 'reviewer_02',
    initiator_name: '王助教 (Reviewer)',
    status: 'failed',
    created_at: '2023-10-25 15:20:00',
    parameters: { prompt_id: 'pr_092', temperature: 0.7 },
    error_stack: 'TimeoutError: LLM endpoint did not respond in 30000ms.'
  }
];

export default function AdminOperationLogsPage() {
  // Metrics calculation
  const total = mockOperationLogs.length;
  const pending = mockOperationLogs.filter(item => item.status === 'pending').length;
  const success = mockOperationLogs.filter(item => item.status === 'success').length;
  const failed = mockOperationLogs.filter(item => item.status === 'failed').length;

  const [searchText, setSearchText] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [currentLog, setCurrentLog] = useState(null);

  // Filter Data
  const filteredData = mockOperationLogs.filter(item => {
    const matchSearch = item.initiator_id.includes(searchText) || item.initiator_name.includes(searchText);
    const matchAction = actionFilter ? item.action === actionFilter : true;
    const matchStatus = statusFilter ? item.status === statusFilter : true;
    return matchSearch && matchAction && matchStatus;
  });

  const handleViewDetails = (record) => {
    setCurrentLog(record);
    setDetailModalVisible(true);
  };

  const columns = [
    {
      title: '操作类型',
      dataIndex: 'action',
      key: 'action',
      render: (action) => AUDIT_ACTION_META[action]?.label || action
    },
    {
      title: '发起人',
      dataIndex: 'initiator_name',
      key: 'initiator_name',
      render: (text, record) => (
        <span>
          {text} <br />
          <Text type="secondary" style={{ fontSize: '12px' }}>{record.initiator_id}</Text>
        </span>
      )
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const meta = AUDIT_STATUS_META[status];
        if (!meta) return status;
        return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
      }
    },
    {
      title: '详情',
      key: 'details',
      align: 'right',
      render: (_, record) => (
        <Tooltip title="查看详细参数与日志">
          <OutlineButton icon={<EyeOutlined />} onClick={() => handleViewDetails(record)} />
        </Tooltip>
      )
    }
  ];

  return (
    <section className="workspace-standard-page admin-operation-logs-page">
      <PageHeading title="操作日志" description="追踪系统与人工操作的详细日志，支持排查故障和失败原因。" />

      <aside className="student-dashboard-main-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '24px' }}>
        <article className="dashboard-metric-card is-blue">
          <span className="metric-icon"><FileDoneOutlined /></span>
          <div>
            <span className="metric-label-row"><span>总操作数</span></span>
            <strong>{total}</strong>
          </div>
        </article>
        <article className="dashboard-metric-card is-amber">
          <span className="metric-icon"><ClockCircleOutlined /></span>
          <div>
            <span className="metric-label-row"><span>执行中</span></span>
            <strong>{pending}</strong>
          </div>
        </article>
        <article className="dashboard-metric-card is-green">
          <span className="metric-icon"><CheckCircleOutlined /></span>
          <div>
            <span className="metric-label-row"><span>操作成功</span></span>
            <strong>{success}</strong>
          </div>
        </article>
        <article className="dashboard-metric-card" style={{ borderTop: '4px solid var(--lf-color-error)', backgroundColor: 'var(--lf-color-bg-subtle)' }}>
          <span className="metric-icon" style={{ color: 'var(--lf-color-error)', backgroundColor: 'rgba(239, 68, 68, 0.1)' }}><CloseCircleOutlined /></span>
          <div>
            <span className="metric-label-row"><span>操作失败</span></span>
            <strong>{failed}</strong>
          </div>
        </article>
      </aside>

      <TablePanel
        title="操作流水"
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
              placeholder="操作类型" 
              style={{ width: 140 }} 
              allowClear
              value={actionFilter}
              onChange={setActionFilter}
            >
              {AUDIT_ACTION_LIST.map(key => (
                <Option key={key} value={key}>{AUDIT_ACTION_META[key].label}</Option>
              ))}
            </Select>
            <Select 
              placeholder="状态" 
              style={{ width: 120 }} 
              allowClear
              value={statusFilter}
              onChange={setStatusFilter}
            >
              {AUDIT_STATUS_LIST.map(key => (
                <Option key={key} value={key}>{AUDIT_STATUS_META[key].label}</Option>
              ))}
            </Select>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          pagination={{ pageSize: 15 }}
        />
      </TablePanel>

      <Modal
        title="操作详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width={700}
      >
        {currentLog && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
            <div>
              <Text strong>操作类型：</Text>
              <Text>{AUDIT_ACTION_META[currentLog.action]?.label || currentLog.action}</Text>
            </div>
            <div>
              <Text strong>发起人：</Text>
              <Text>{currentLog.initiator_name} ({currentLog.initiator_id})</Text>
            </div>
            <div>
              <Text strong>时间：</Text>
              <Text>{currentLog.created_at}</Text>
            </div>
            
            <div style={{ marginTop: '8px' }}>
              <Text strong>请求参数 (Parameters):</Text>
              <div style={{ 
                background: 'var(--lf-color-bg-subtle)', 
                padding: '12px', 
                borderRadius: '8px', 
                marginTop: '8px',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                border: '1px solid var(--lf-color-border)'
              }}>
                {JSON.stringify(currentLog.parameters, null, 2)}
              </div>
            </div>

            {currentLog.error_stack && (
              <div style={{ marginTop: '8px' }}>
                <Text strong style={{ color: 'var(--lf-color-error)' }}>失败堆栈 (Error Stack):</Text>
                <div style={{ 
                  background: 'rgba(239, 68, 68, 0.05)', 
                  color: 'var(--lf-color-error)',
                  padding: '12px', 
                  borderRadius: '8px', 
                  marginTop: '8px',
                  fontFamily: 'monospace',
                  whiteSpace: 'pre-wrap',
                  border: '1px solid rgba(239, 68, 68, 0.2)'
                }}>
                  {currentLog.error_stack}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
