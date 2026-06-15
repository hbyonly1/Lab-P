import { useEffect, useState } from 'react';
import {
  Button,
  Drawer,
  Form,
  InputNumber,
  Progress,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import { ReloadOutlined, RetweetOutlined, RocketOutlined } from '@ant-design/icons';
import { apiClient, apiErrorMessage } from '../../services/apiClient.js';

const statusColors = {
  pending: 'default',
  running: 'processing',
  success: 'success',
  failed: 'error',
  canceled: 'warning',
};

export default function JobsPage() {
  const [form] = Form.useForm();
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get('/api/system/jobs');
      setJobs(response.data.data ?? []);
    } catch (error) {
      message.error(apiErrorMessage(error, '任务列表加载失败'));
    } finally {
      setLoading(false);
    }
  };

  const loadLogs = async (job) => {
    setSelectedJob(job);
    try {
      const response = await apiClient.get(`/api/system/jobs/${job.id}/logs`);
      setLogs(response.data.data ?? []);
    } catch (error) {
      message.error(apiErrorMessage(error, '任务日志加载失败'));
    }
  };

  const submitAnalyzeJob = async (values) => {
    setSubmitting(true);
    try {
      await apiClient.post('/api/system/jobs', {
        type: 'ai_analyze',
        payload: {
          episode_id: values.episode_id,
          force_reanalyze: values.force_reanalyze ?? false,
        },
      });
      message.success('AI 分析任务已提交');
      form.resetFields();
      loadJobs();
    } catch (error) {
      message.error(apiErrorMessage(error, '任务提交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const retryJob = async (job) => {
    try {
      await apiClient.post(`/api/system/jobs/${job.id}/retry`);
      message.success('重试任务已提交');
      loadJobs();
    } catch (error) {
      message.error(apiErrorMessage(error, '任务重试失败'));
    }
  };

  useEffect(() => {
    Promise.resolve().then(loadJobs);
  }, []);

  const columns = [
    {
      title: 'ID',
      dataIndex: 'id',
      width: 72,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 140,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (value) => <Tag color={statusColors[value] ?? 'default'}>{value}</Tag>,
    },
    {
      title: '进度',
      dataIndex: 'progress',
      width: 180,
      render: (value) => <Progress percent={Math.round(value ?? 0)} size="small" />,
    },
    {
      title: '错误',
      dataIndex: 'error',
      ellipsis: true,
      render: (value) => value || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      width: 190,
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => loadLogs(record)}>
            日志
          </Button>
          <Tooltip title="重试任务">
            <Button
              size="small"
              icon={<RetweetOutlined />}
              disabled={record.status !== 'failed'}
              onClick={() => retryJob(record)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];

  return (
    <>
      <section className="workspace-table-panel">
        <Form
          form={form}
          className="job-create-form"
          layout="inline"
          initialValues={{ force_reanalyze: false }}
          onFinish={submitAnalyzeJob}
        >
          <Form.Item
            name="episode_id"
            label="Episode ID"
            rules={[{ required: true, message: '请输入剧集 ID' }]}
          >
            <InputNumber min={1} precision={0} />
          </Form.Item>
          <Form.Item name="force_reanalyze" label="强制重跑" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={submitting} icon={<RocketOutlined />}>
              触发 AI 分析
            </Button>
          </Form.Item>
          <Form.Item className="job-refresh-action">
            <Button icon={<ReloadOutlined />} onClick={loadJobs}>
              刷新
            </Button>
          </Form.Item>
        </Form>

        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={jobs}
          pagination={{ pageSize: 10 }}
          scroll={{ x: '100%' }}
        />
      </section>

      <Drawer
        title={selectedJob ? `任务 #${selectedJob.id} 日志` : '任务日志'}
        open={Boolean(selectedJob)}
        onClose={() => {
          setSelectedJob(null);
          setLogs([]);
        }}
        width={560}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {logs.map((log) => (
            <div className="job-log-line" key={log.id}>
              <Tag color={log.level === 'error' ? 'error' : 'default'}>{log.level}</Tag>
              <span>{new Date(log.created_at).toLocaleString()}</span>
              <strong>{log.message}</strong>
              {log.context_json && log.context_json !== '{}' ? <pre>{log.context_json}</pre> : null}
            </div>
          ))}
        </Space>
      </Drawer>
    </>
  );
}
