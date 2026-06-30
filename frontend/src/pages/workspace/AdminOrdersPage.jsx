import React, { useState, useMemo } from 'react';
import { Table, Tag, Button, message, Popconfirm, Space, Input, Select } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  DollarOutlined,
  WalletOutlined,
  WarningOutlined,
  SearchOutlined
} from '@ant-design/icons';
import { PageHeading, StatCard, TablePanel, StatusBadge, OutlineButton } from '../../components/ui';
import { ORDER_STATUS_META } from '../../constants/statusEnums';

// ================= Mock Data =================
const initialOrders = [
  {
    id: 'ORD-20260630-001',
    studentId: '20210001',
    type: 'pro_upgrade',
    typeLabel: 'Pro 包月升级',
    amount: 50,
    createdAt: '2026-06-30 08:00:00',
    status: 'pending_payment',
  },
  {
    id: 'ORD-20260630-002',
    studentId: '20210002',
    type: 'single_use',
    typeLabel: '单次代劳',
    amount: 8,
    createdAt: '2026-06-30 08:15:00',
    status: 'pending_payment',
  },
  {
    id: 'ORD-20260629-015',
    studentId: '20210003',
    type: 'plus_upgrade',
    typeLabel: 'Plus 包月升级',
    amount: 30,
    createdAt: '2026-06-29 18:30:00',
    status: 'paid',
  },
  {
    id: 'ORD-20260629-016',
    studentId: '20210004',
    type: 'single_use',
    typeLabel: '单次代劳',
    amount: 16,
    createdAt: '2026-06-29 19:00:00',
    status: 'rejected',
  },
];


export default function AdminOrdersPage() {
  const [orders, setOrders] = useState(initialOrders);
  const [searchText, setSearchText] = useState('');
  const [typeFilter, setTypeFilter] = useState(undefined);
  const [statusFilter, setStatusFilter] = useState(undefined);

  // ================= 派生指标数据 =================
  const pendingCount = orders.filter((o) => o.status === 'pending_payment').length;
  const todayRevenue = orders
    .filter((o) => o.status === 'paid' && o.createdAt.startsWith('2026-06-30'))
    .reduce((sum, o) => sum + o.amount, 0);
  const totalRevenue = orders
    .filter((o) => o.status === 'paid')
    .reduce((sum, o) => sum + o.amount, 0);
  const errorCount = orders.filter((o) => o.status === 'rejected').length;

  const metrics = [
    { key: 'pending', title: '待核实', value: pendingCount, tone: 'amber', icon: <ExclamationCircleOutlined /> },
    { key: 'today', title: '今日收款', value: `¥ ${todayRevenue}`, tone: 'blue', icon: <DollarOutlined /> },
    { key: 'total', title: '累计收款', value: `¥ ${totalRevenue}`, tone: 'green', icon: <WalletOutlined /> },
    { key: 'error', title: '支付异常 (驳回)', value: errorCount, tone: 'violet', icon: <WarningOutlined /> },
  ];

  // ================= 操作逻辑 =================
  const handleVerify = (id) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: 'paid' } : o))
    );
    message.success('已确认收款，订单已放行');
  };

  const handleReject = (id) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status: 'rejected' } : o))
    );
    message.warning('订单已驳回');
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
          <Tag color={isUpgrade ? 'blue' : 'default'} bordered={false}>{text}</Tag>
        );
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (amount) => <span style={{ fontWeight: 500, color: '#333' }}>¥{amount}</span>,
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
              description={`确认学号 ${record.studentId} 已支付 ¥${record.amount} 吗？`}
              onConfirm={() => handleVerify(record.id)}
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
              description="该笔订单将被标记为支付异常，确定驳回？"
              onConfirm={() => handleReject(record.id)}
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
    return orders.filter((o) => {
      const lowerSearch = searchText.toLowerCase().trim();
      const matchSearch = String(o.studentId || '').toLowerCase().includes(lowerSearch) ||
        String(o.id || '').toLowerCase().includes(lowerSearch);
      const matchType = typeFilter ? o.type === typeFilter : true;
      const matchStatus = statusFilter ? o.status === statusFilter : true;
      return matchSearch && matchType && matchStatus;
    });
  }, [orders, searchText, typeFilter, statusFilter]);

  return (
    <div className="workspace-standard-page">
      <PageHeading
        title="订单管理"
        description="核对微信/支付宝收款通知，并放行或驳回对应订单。"
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' }}>
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
              <Select.Option value="pro_upgrade">Pro 包月</Select.Option>
              <Select.Option value="plus_upgrade">Plus 包月</Select.Option>
              <Select.Option value="single_use">单次代劳</Select.Option>
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
          pagination={false}
          rowKey="id"
          scroll={{ x: 800 }}
        />
      </TablePanel>
    </div>
  );
}
