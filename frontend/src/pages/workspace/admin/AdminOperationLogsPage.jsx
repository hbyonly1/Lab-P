import React, { useState, useEffect } from 'react';
import { Table, Input, Select, Space, Modal, Tooltip, Typography } from 'antd';
import Editor from '@monaco-editor/react';
import {
  FileDoneOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  SearchOutlined,
  EyeOutlined
} from '@ant-design/icons';
import { PageHeading, TablePanel, OutlineButton, StatusBadge } from '../../../components/ui/index.js';
import {
  AUDIT_ACTION_META,
  AUDIT_ACTION_LIST,
  AUDIT_STATUS_META,
  AUDIT_STATUS_LIST
} from '../../../constants/auditEnums.js';

import { auditApi } from '../../../services/auditApi.js';

const { Option } = Select;
const { Text } = Typography;

function formatLogDetails(details, fallback = '') {
  if (!details) return '';
  try {
    return JSON.stringify(typeof details === 'string' ? JSON.parse(details) : details, null, 2);
  } catch {
    return String(details || fallback);
  }
}

function JsonDetailsEditor({ value }) {
  return (
    <div className="operation-log-json-editor">
      <Editor
        height="520px"
        language="json"
        theme="vs"
        value={formatLogDetails(value)}
        loading="正在加载 JSON 编辑器..."
        options={{
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          domReadOnly: true,
          folding: true,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
          fontSize: 13,
          lineNumbers: 'on',
          minimap: { enabled: true },
          padding: { top: 12, bottom: 12 },
          readOnly: true,
          renderValidationDecorations: 'off',
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: 'on',
        }}
      />
    </div>
  );
}

export default function AdminOperationLogsPage() {
  const [operationLogs, setOperationLogs] = useState([]);
  const [loading, setLoading] = useState(false);

  // Metrics calculation
  const total = operationLogs.length;
  const pending = operationLogs.filter(item => item.status === 'pending').length;
  const success = operationLogs.filter(item => item.status === 'success').length;
  const failed = operationLogs.filter(item => item.status === 'failed').length;

  const [searchText, setSearchText] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [detailModalVisible, setDetailModalVisible] = useState(false);
  const [currentLog, setCurrentLog] = useState(null);

  useEffect(() => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const data = await auditApi.getAuditLogs();
        setOperationLogs(data);
      } catch (err) {
        console.error('Failed to fetch audit logs:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  }, []);

  // Filter Data
  const filteredData = operationLogs.filter(item => {
    const initiatorName = item.initiator_name || '';
    const initiatorId = item.initiator_id ? String(item.initiator_id) : '';
    const matchSearch = initiatorId.includes(searchText) || initiatorName.includes(searchText);
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
      key: 'created_at',
      render: (dateStr) => dateStr ? new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z').toLocaleString('zh-CN', { hour12: false }) : '-'
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

      <aside className="student-dashboard-main-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
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
          dataSource={filteredData}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10, showSizeChanger: true }}
        />
      </TablePanel>

      <Modal
        title="操作详情"
        open={detailModalVisible}
        onCancel={() => setDetailModalVisible(false)}
        footer={null}
        width="min(1100px, 92vw)"
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
              <Text>{currentLog.created_at ? new Date(currentLog.created_at.endsWith('Z') ? currentLog.created_at : currentLog.created_at + 'Z').toLocaleString('zh-CN', { hour12: false }) : '-'}</Text>
            </div>

            {currentLog.details && (
              <div style={{ marginTop: '8px' }}>
                <Text strong>详情信息 (Details):</Text>
                <JsonDetailsEditor value={currentLog.details} />
              </div>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
