import React, { useState, useEffect } from 'react';
import { Table, Modal, Typography, Button, message } from 'antd';
import { MessageOutlined } from '@ant-design/icons';
import { PageHeading, StatCard, TablePanel } from '../../../components/ui/index.js';
import { getFeedbacks, getFeedbackStats } from '../../../services/feedbackApi.js';

const { Text } = Typography;

export default function AdminFeedbackPage() {
  const [feedbacks, setFeedbacks] = useState([]);
  const [stats, setStats] = useState({ total: 0 });
  const [loading, setLoading] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState(null);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [data, statsData] = await Promise.all([getFeedbacks(), getFeedbackStats()]);
      setFeedbacks(data);
      setStats(statsData);
    } catch (err) {
      console.error('Failed to fetch feedbacks:', err);
      message.error('获取反馈数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleView = (record) => {
    setCurrentFeedback(record);
    setDetailVisible(true);
  };

  const columns = [
    {
      title: '学生 ID',
      dataIndex: 'user_id',
      key: 'user_id',
      width: 100,
      render: (id) => id ?? '—',
    },
    {
      title: '姓名',
      dataIndex: 'username',
      key: 'username',
      render: (name) => name ?? '—',
    },
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (ts) =>
        ts
          ? new Date(ts.endsWith('Z') ? ts : ts + 'Z').toLocaleString('zh-CN', { hour12: false })
          : '—',
    },
    {
      title: '',
      key: 'action',
      align: 'right',
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => handleView(record)}>
          详情
        </Button>
      ),
    },
  ];

  return (
    <section className="workspace-standard-page admin-feedback-page">
      <PageHeading
        title="用户反馈"
        description="查看学生提交的使用反馈与问题报告。"
      />

      {/* Stats — 复用 .ui-stat-grid + StatCard */}
      <div className="ui-stat-grid" >
        <StatCard
          icon={<MessageOutlined />}
          label="总反馈数"
          tone="blue"
          value={stats.total}
        />
      </div>

      {/* Table — 复用 TablePanel */}
      <TablePanel title="反馈列表">
        <Table
          dataSource={feedbacks}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          size="small"
          scroll={{ x: 600 }}
        />
      </TablePanel>

      {/* Detail Modal */}
      <Modal
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        title="反馈详情"
        width={560}
      >
        {currentFeedback && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <Text type="secondary">学生 ID：</Text>{' '}
              <Text>{currentFeedback.user_id ?? '—'}</Text>
            </div>
            <div>
              <Text type="secondary">用户名：</Text>{' '}
              <Text>{currentFeedback.username ?? '—'}</Text>
            </div>
            <div>
              <Text type="secondary">联系方式：</Text>{' '}
              <Text>{currentFeedback.contact_info || '未提供'}</Text>
            </div>
            <div>
              <Text type="secondary">提交时间：</Text>{' '}
              <Text>
                {currentFeedback.created_at
                  ? new Date(
                    currentFeedback.created_at.endsWith('Z')
                      ? currentFeedback.created_at
                      : currentFeedback.created_at + 'Z'
                  ).toLocaleString('zh-CN', { hour12: false })
                  : '—'}
              </Text>
            </div>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
                问题描述：
              </Text>
              <div
                style={{
                  background: 'var(--lf-color-bg-subtle)',
                  border: '1px solid var(--lf-color-border)',
                  borderRadius: 6,
                  padding: '12px 14px',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.7,
                }}
              >
                {currentFeedback.description}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
