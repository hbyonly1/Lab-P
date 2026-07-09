import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Tag, message, Popconfirm, Space, Input, Select } from 'antd';
import {
  ExclamationCircleOutlined,
  DollarOutlined,
  WalletOutlined,
  WarningOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { PageHeading, StatCard, TablePanel, StatusBadge, OutlineButton } from '../../../components/ui';
import { ORDER_STATUS_META } from '../../../constants/statusEnums';
import { getOrders, verifyOrderPayment } from '../../../services/ordersApi';

function toTimestamp(value) {
  if (!value) return 0;
  const normalized = value.endsWith?.('Z') ? value : `${value}Z`;
  const time = new Date(normalized).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function formatDateTime(value) {
  const time = toTimestamp(value);
  return time > 0 ? new Date(time).toLocaleString() : '-';
}

function formatCurrency(value) {
  return Number(value || 0).toFixed(2);
}

function isToday(timestamp) {
  if (!timestamp) return false;
  const date = new Date(timestamp);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(undefined);
  const [statusFilter, setStatusFilter] = useState(undefined);
  const [pagination, setPagination] = useState({ current: 1, pageSize: 20 });
  const [orderTotal, setOrderTotal] = useState(0);
  const [summary, setSummary] = useState({});

  // ================= 派生指标数据 =================
  const paymentRows = useMemo(() => orders, [orders]);
  const pendingCount = summary.pendingCount ?? paymentRows.filter((o) => o.status === 'pending_payment').length;
  const todayRevenue = summary.paidTodayAmount ?? paymentRows
    .filter((o) => o.status === 'paid' && isToday(o.createdAtMs))
    .reduce((sum, o) => sum + o.amount, 0);
  const totalRevenue = summary.paidTotalAmount ?? paymentRows
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.amount, 0);
  const errorCount = summary.rejectedCount ?? paymentRows.filter((o) => o.status === 'rejected').length;

  const metrics = [
    { key: 'pending', title: '待确认', value: pendingCount, tone: 'amber', icon: <ExclamationCircleOutlined /> },
    { key: 'today', title: '今日收款', value: `¥ ${todayRevenue.toFixed(2)}`, tone: 'blue', icon: <DollarOutlined /> },
    { key: 'total', title: '累计收款', value: `¥ ${totalRevenue.toFixed(2)}`, tone: 'green', icon: <WalletOutlined /> },
    { key: 'error', title: '支付异常 (驳回)', value: errorCount, tone: 'violet', icon: <WarningOutlined /> },
  ];

  // ================= 操作逻辑 =================
  const fetchOrders = useCallback(async () => {
    try {
      const data = await getOrders({
        page: pagination.current || 1,
        pageSize: pagination.pageSize || 20,
        query: searchText.trim() || undefined,
        plan: typeFilter || undefined,
        status: statusFilter || undefined,
      });
      const rows = data.items || [];
      setOrderTotal(data.total || 0);
      setSummary(data.summary || {});
      setOrders(rows.map(o => ({
        id: o.id,
        studentId: o.student_username || o.student_id,
        experimentId: o.experiment_id,
        type: o.plan,
        orderType: o.order_type,
        typeLabel: o.order_type === 'plan_upgrade' ? `${o.plan} 套餐` : '按实验计价',
        amount: o.amount,
        createdAt: formatDateTime(o.created_at),
        createdAtMs: toTimestamp(o.created_at),
        status: o.status,
        submissionBatchId: o.submission_batch_id,
        items: o.items || [],
        isBatch: Boolean(o.submission_batch_id) || (o.items || []).length > 1,
      })));
    } catch (err) {
      message.error('无法拉取订单数据');
    }
  }, [pagination.current, pagination.pageSize, searchText, statusFilter, typeFilter]);

  useEffect(() => {
    const timer = window.setTimeout(fetchOrders, 250);
    return () => window.clearTimeout(timer);
  }, [fetchOrders]);

  const handleVerify = async (record) => {
    try {
      await verifyOrderPayment(record.id, 'verify');
      message.success('已确认支付，订单已放行');
      fetchOrders();
    } catch (e) {
      message.error('支付确认失败');
    }
  };

  const handleReject = async (record) => {
    try {
      await verifyOrderPayment(record.id, 'reject');
      message.warning('订单已驳回');
      fetchOrders();
    } catch (e) {
      message.error('驳回失败');
    }
  };

  // ================= 表格列定义 =================
  const columns = [
    {
      title: '订单号',
      dataIndex: 'id',
      key: 'id',
      width: 180,
    },
    {
      title: '学号',
      dataIndex: 'studentId',
      key: 'studentId',
      width: 120,
    },
    {
      title: '订单类型',
      dataIndex: 'typeLabel',
      key: 'type',
      render: (text, record) => {
        const isUpgrade = record.orderType === 'plan_upgrade';
        return (
          <Space>
            <Tag color={isUpgrade ? 'blue' : 'default'} bordered={false}>{text}</Tag>
            {record.submissionBatchId && <Tag color="gold" bordered={false}>提交组</Tag>}
          </Space>
        );
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount) => <span style={{ fontWeight: 500, color: '#333' }}>¥{formatCurrency(amount)}</span>,
    },
    {
      title: '提交时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (status) => {
        const meta = ORDER_STATUS_META[status] || ORDER_STATUS_META.pending_payment;
        return <StatusBadge tone={meta.tone} label={meta.label} />;
      },
    },
    {
      title: '操作',
      key: 'actions',
      align: 'right',
      render: (_, record) => {
        const isPending = record.status === 'pending_payment';
        return (
          <Space>
            <Popconfirm
              title="确认收款"
              description={`确认学号 ${record.studentId} 已支付 ¥${formatCurrency(record.amount)} 吗？${record.submissionBatchId ? `将放行提交组 ${record.submissionBatchId}。` : ''}`}
              onConfirm={() => handleVerify(record)}
              okText="是的，已收到"
              cancelText="取消"
              disabled={!isPending}
            >
              <OutlineButton
                disabled={!isPending}
                style={!isPending
                  ? { color: '#bfbfbf', borderColor: '#d9d9d9', background: '#f5f5f5' }
                  : { color: '#52c41a', borderColor: '#b7eb8f' }
                }
              >
                确认收款
              </OutlineButton>
            </Popconfirm>

            <Popconfirm
              title="驳回订单"
              description={record.submissionBatchId ? '该提交组关联的任务都将标记为支付异常，确定驳回？' : '该笔订单将被标记为支付异常，确定驳回？'}
              onConfirm={() => handleReject(record)}
              okText="驳回"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              disabled={!isPending}
            >
              <OutlineButton
                disabled={!isPending}
                style={!isPending
                  ? { color: '#bfbfbf', borderColor: '#d9d9d9', background: '#f5f5f5' }
                  : { color: '#ff4d4f', borderColor: '#ffa39e' }
                }
              >
                驳回
              </OutlineButton>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const filteredOrders = paymentRows;

  const expandedRowRender = (record) => {
    const childColumns = [
      { title: '明细类型', dataIndex: 'item_type', key: 'item_type', width: 180 },
      {
        title: '实验',
        dataIndex: 'experiment_id',
        key: 'experiment_id',
        render: (value) => value || '套餐升级',
      },
      {
        title: '提交',
        dataIndex: 'submission_id',
        key: 'submission_id',
        render: (value) => value || '-',
      },
      {
        title: '数量',
        dataIndex: 'quantity',
        key: 'quantity',
      },
      {
        title: '单价',
        dataIndex: 'unit_amount',
        key: 'unit_amount',
        render: (amount) => `¥${formatCurrency(amount)}`,
      },
      {
        title: '金额',
        dataIndex: 'total_amount',
        key: 'total_amount',
        render: (amount) => `¥${formatCurrency(amount)}`,
      },
      {
        title: '来源',
        dataIndex: ['pricing_snapshot', 'source'],
        key: 'pricing_source',
        render: (value) => <Tag bordered={false}>{value}</Tag>,
      },
    ];

    return (
      <Table
        columns={childColumns}
        dataSource={record.items}
        pagination={false}
        rowKey={(item) => `${item.item_type}-${item.submission_id || item.experiment_id || item.id}`}
        size="small"
      />
    );
  };

  return (
    <div className="workspace-standard-page">
      <PageHeading
        title="订单管理"
        description="核对微信/支付宝收款通知，并放行或驳回对应订单。"
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px' }}>
        {metrics.map((metric) => (
          <StatCard
            key={metric.key}
            tone={metric.tone}
            label={metric.title}
            value={metric.value}
            icon={metric.icon}
          />
        ))}
      </div>

      <TablePanel
        title="收款处理列表"
        actions={
          <Space>
            <Input
              placeholder="搜索学号 / 订单号"
              prefix={<SearchOutlined />}
              value={searchText}
              onChange={e => {
                setSearchText(e.target.value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
              style={{ width: 200 }}
            />
            <Select
              placeholder="订单类型"
              style={{ width: 140 }}
              allowClear
              value={typeFilter}
              onChange={(value) => {
                setTypeFilter(value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            >
              <Select.Option value="pro">Pro 套餐</Select.Option>
              <Select.Option value="plus">Plus 套餐</Select.Option>
              <Select.Option value="pay_per_use">按实验计价</Select.Option>
            </Select>
            <Select
              placeholder="状态"
              style={{ width: 120 }}
              allowClear
              value={statusFilter}
              onChange={(value) => {
                setStatusFilter(value);
                setPagination((prev) => ({ ...prev, current: 1 }));
              }}
            >
              <Select.Option value="pending_payment">待核实</Select.Option>
              <Select.Option value="paid">已收款</Select.Option>
              <Select.Option value="rejected">已驳回</Select.Option>
            </Select>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={filteredOrders}
          expandable={{
            expandedRowRender,
            rowExpandable: (record) => (record.items || []).length > 0,
          }}
          pagination={{
            ...pagination,
            total: orderTotal,
            showSizeChanger: false,
          }}
          onChange={(nextPagination) => {
            setPagination({
              current: nextPagination.current || 1,
              pageSize: nextPagination.pageSize || pagination.pageSize || 20,
            });
          }}
          rowKey="id"
          scroll={{ x: 800 }}
        />
      </TablePanel>
    </div>
  );
}
