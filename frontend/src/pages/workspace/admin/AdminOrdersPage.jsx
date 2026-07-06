import React, { useEffect, useMemo, useState } from 'react';
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

const PAY_PER_USE_BATCH_WINDOW_MS = 10 * 1000;

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

function makeBatchKey(order) {
  if (order.type !== 'pay_per_use') return order.id;
  const bucket = Math.floor((order.createdAtMs || 0) / PAY_PER_USE_BATCH_WINDOW_MS);
  return ['pay_per_use', order.studentId, order.status, bucket].join(':');
}

function makeBatchDisplayId(firstOrder) {
  return `BATCH-${String(firstOrder.id || '').replace(/^ORD-/, '').slice(-6) || 'PAY'}`;
}

function buildPaymentRows(orderList) {
  const groups = new Map();

  orderList.forEach((order) => {
    const key = makeBatchKey(order);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(order);
  });

  return Array.from(groups.entries()).map(([key, group]) => {
    const sortedChildren = [...group].sort((a, b) => (a.createdAtMs || 0) - (b.createdAtMs || 0));
    const first = sortedChildren[0];
    const amount = sortedChildren.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const isBatch = first.type === 'pay_per_use' && sortedChildren.length > 1;

    return {
      ...first,
      id: isBatch ? makeBatchDisplayId(first) : first.id,
      orderIds: sortedChildren.map(item => item.id),
      childOrders: sortedChildren,
      isBatch,
      typeLabel: isBatch ? `pay_per_use × ${sortedChildren.length}` : first.typeLabel,
      amount,
      createdAt: first.createdAt,
      createdAtMs: first.createdAtMs,
    };
  }).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState([]);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(undefined);
  const [statusFilter, setStatusFilter] = useState(undefined);

  // ================= 派生指标数据 =================
  const paymentRows = useMemo(() => buildPaymentRows(orders), [orders]);
  const pendingCount = paymentRows.filter((o) => o.status === 'pending_payment').length;
  const todayRevenue = paymentRows
    .filter((o) => o.status === 'paid' && isToday(o.createdAtMs))
    .reduce((sum, o) => sum + o.amount, 0);
  const totalRevenue = paymentRows
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.amount, 0);
  const errorCount = paymentRows.filter((o) => o.status === 'rejected').length;

  const metrics = [
    { key: 'pending', title: '待确认', value: pendingCount, tone: 'amber', icon: <ExclamationCircleOutlined /> },
    { key: 'today', title: '今日收款', value: `¥ ${todayRevenue.toFixed(2)}`, tone: 'blue', icon: <DollarOutlined /> },
    { key: 'total', title: '累计收款', value: `¥ ${totalRevenue.toFixed(2)}`, tone: 'green', icon: <WalletOutlined /> },
    { key: 'error', title: '支付异常 (驳回)', value: errorCount, tone: 'violet', icon: <WarningOutlined /> },
  ];

  // ================= 操作逻辑 =================
  const fetchOrders = async () => {
    try {
      const data = await getOrders();
      setOrders(data.map(o => ({
        id: o.id,
        studentId: o.student_username || o.student_id,
        experimentId: o.experiment_id,
        type: o.plan,
        typeLabel: o.plan,
        amount: o.amount,
        createdAt: formatDateTime(o.created_at),
        createdAtMs: toTimestamp(o.created_at),
        status: o.status
      })));
    } catch (err) {
      message.error('无法拉取订单数据');
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const handleVerify = async (record) => {
    try {
      for (const orderId of record.orderIds || [record.id]) {
        await verifyOrderPayment(orderId, 'verify');
      }
      message.success('已确认支付，订单已放行');
      fetchOrders();
    } catch (e) {
      message.error('支付确认失败');
    }
  };

  const handleReject = async (record) => {
    try {
      for (const orderId of record.orderIds || [record.id]) {
        await verifyOrderPayment(orderId, 'reject');
      }
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
        const isUpgrade = record.type.includes('upgrade');
        return (
          <Space>
            <Tag color={isUpgrade ? 'blue' : 'default'} bordered={false}>{text}</Tag>
            {record.isBatch && <Tag color="gold" bordered={false}>合并收款</Tag>}
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
              description={`确认学号 ${record.studentId} 已支付 ¥${formatCurrency(record.amount)} 吗？${record.isBatch ? `将放行 ${record.childOrders.length} 个实验。` : ''}`}
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
              description={record.isBatch ? `该合并收款下 ${record.childOrders.length} 笔订单都将标记为支付异常，确定驳回？` : '该笔订单将被标记为支付异常，确定驳回？'}
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

  const filteredOrders = useMemo(() => {
    return paymentRows.filter((o) => {
      const lowerSearch = searchText.toLowerCase().trim();
      const matchSearch = String(o.studentId || '').toLowerCase().includes(lowerSearch) ||
        String(o.id || '').toLowerCase().includes(lowerSearch) ||
        (o.childOrders || []).some(child =>
          String(child.id || '').toLowerCase().includes(lowerSearch) ||
          String(child.experimentId || '').toLowerCase().includes(lowerSearch)
        );
      const matchType = typeFilter ? o.type === typeFilter : true;
      const matchStatus = statusFilter ? o.status === statusFilter : true;
      return matchSearch && matchType && matchStatus;
    });
  }, [paymentRows, searchText, typeFilter, statusFilter]);

  const expandedRowRender = (record) => {
    const childColumns = [
      { title: '订单号', dataIndex: 'id', key: 'id', width: 180 },
      {
        title: '实验',
        dataIndex: 'experimentId',
        key: 'experimentId',
        render: (value) => value || '套餐升级',
      },
      {
        title: 'plan',
        dataIndex: 'typeLabel',
        key: 'typeLabel',
        render: (value) => <Tag bordered={false}>{value}</Tag>,
      },
      {
        title: '金额',
        dataIndex: 'amount',
        key: 'amount',
        render: (amount) => `¥${formatCurrency(amount)}`,
      },
      { title: '提交时间', dataIndex: 'createdAt', key: 'createdAt' },
      {
        title: '状态',
        dataIndex: 'status',
        key: 'status',
        render: (status) => {
          const meta = ORDER_STATUS_META[status] || ORDER_STATUS_META.pending_payment;
          return <StatusBadge tone={meta.tone} label={meta.label} />;
        },
      },
    ];

    return (
      <Table
        columns={childColumns}
        dataSource={record.childOrders}
        pagination={false}
        rowKey="id"
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
              onChange={e => setSearchText(e.target.value)}
              style={{ width: 200 }}
            />
            <Select
              placeholder="订单类型"
              style={{ width: 140 }}
              allowClear
              value={typeFilter}
              onChange={setTypeFilter}
            >
              <Select.Option value="pro">Pro 包月</Select.Option>
              <Select.Option value="plus">Plus 包月</Select.Option>
              <Select.Option value="pay_per_use">单次代劳</Select.Option>
            </Select>
            <Select
              placeholder="状态"
              style={{ width: 120 }}
              allowClear
              value={statusFilter}
              onChange={setStatusFilter}
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
            rowExpandable: (record) => record.isBatch,
          }}
          pagination={false}
          rowKey="id"
          scroll={{ x: 800 }}
        />
      </TablePanel>
    </div>
  );
}
