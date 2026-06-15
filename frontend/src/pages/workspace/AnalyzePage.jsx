import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Form,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  message,
} from 'antd';
import {
  ArrowLeftOutlined,
  FileSearchOutlined,
  ReloadOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { apiClient, apiErrorMessage } from '../../services/apiClient.js';

const statusColors = {
  pending: 'default',
  processing: 'processing',
  success: 'success',
  failed: 'error',
  running: 'processing',
  canceled: 'warning',
};

function parsePayload(value) {
  try {
    return JSON.parse(value || '{}');
  } catch {
    return {};
  }
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function hasSubtitle(episode) {
  return Boolean(episode.subtitle_content || episode.subtitle_url);
}

export default function AnalyzePage() {
  const { jobId } = useParams();
  return jobId ? <AnalyzeJobDetail jobId={Number(jobId)} /> : <AnalyzeQueue />;
}

function AnalyzeQueue() {
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [dramas, setDramas] = useState([]);
  const [episodes, setEpisodes] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submittingId, setSubmittingId] = useState(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [filters, setFilters] = useState({ drama_id: 'all', analyze_status: 'all', subtitle: 'all' });

  const loadData = async () => {
    setLoading(true);
    try {
      const [dramasResponse, episodesResponse, jobsResponse] = await Promise.all([
        apiClient.get('/api/dramas'),
        apiClient.get('/api/episodes'),
        apiClient.get('/api/system/jobs', { params: { type: 'ai_analyze', limit: 200 } }),
      ]);
      setDramas(dramasResponse.data.data ?? []);
      setEpisodes(episodesResponse.data.data ?? []);
      setJobs(jobsResponse.data.data ?? []);
    } catch (error) {
      message.error(apiErrorMessage(error, 'AI 生产队列加载失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.resolve().then(loadData);
  }, []);

  const dramaMap = useMemo(() => new Map(dramas.map((drama) => [drama.id, drama])), [dramas]);

  const latestJobByEpisode = useMemo(() => {
    const map = new Map();
    jobs.forEach((job) => {
      const episodeId = parsePayload(job.payload_json).episode_id;
      if (!episodeId) {
        return;
      }
      const current = map.get(episodeId);
      if (!current || new Date(job.created_at) > new Date(current.created_at)) {
        map.set(episodeId, job);
      }
    });
    return map;
  }, [jobs]);

  const rows = useMemo(
    () =>
      episodes
        .map((episode) => ({
          ...episode,
          drama_title: dramaMap.get(episode.drama_id)?.title ?? `短剧 #${episode.drama_id}`,
          latest_job: latestJobByEpisode.get(episode.id),
          subtitle_ready: hasSubtitle(episode),
        }))
        .filter((episode) => {
          if (filters.drama_id !== 'all' && episode.drama_id !== filters.drama_id) {
            return false;
          }
          if (filters.analyze_status !== 'all' && episode.analyze_status !== filters.analyze_status) {
            return false;
          }
          if (filters.subtitle === 'ready' && !episode.subtitle_ready) {
            return false;
          }
          if (filters.subtitle === 'missing' && episode.subtitle_ready) {
            return false;
          }
          return true;
        }),
    [dramaMap, episodes, filters, latestJobByEpisode],
  );

  const metrics = useMemo(
    () => ({
      pending: episodes.filter((episode) => episode.analyze_status === 'pending').length,
      processing: episodes.filter((episode) => episode.analyze_status === 'processing').length,
      failed: episodes.filter((episode) => episode.analyze_status === 'failed').length,
      draft: episodes.reduce((total, episode) => total + Number(episode.draft_highlight_count ?? 0), 0),
    }),
    [episodes],
  );

  const submitJob = async (episode, forceReanalyze = false) => {
    setSubmittingId(episode.id);
    try {
      const response = await apiClient.post('/api/system/jobs', {
        type: 'ai_analyze',
        payload: {
          episode_id: episode.id,
          force_reanalyze: forceReanalyze,
        },
      });
      message.success(forceReanalyze ? '强制重跑任务已提交' : 'AI 识别任务已提交');
      await loadData();
      navigate(`/workspace/analyze/jobs/${response.data.data.id}`);
    } catch (error) {
      message.error(apiErrorMessage(error, 'AI 任务提交失败'));
    } finally {
      setSubmittingId(null);
    }
  };

  const submitBatch = async (forceReanalyze = false) => {
    const selected = rows.filter((item) => selectedRowKeys.includes(item.id));
    if (!selected.length) {
      message.warning('请选择剧集');
      return;
    }
    setLoading(true);
    try {
      await Promise.all(
        selected.map((episode) =>
          apiClient.post('/api/system/jobs', {
            type: 'ai_analyze',
            payload: { episode_id: episode.id, force_reanalyze: forceReanalyze },
          }),
        ),
      );
      message.success(`已提交 ${selected.length} 个 AI 任务`);
      setSelectedRowKeys([]);
      await loadData();
    } catch (error) {
      message.error(apiErrorMessage(error, '批量提交失败'));
    } finally {
      setLoading(false);
    }
  };

  const columns = [
    {
      title: '短剧',
      dataIndex: 'drama_title',
      width: 180,
      ellipsis: true,
    },
    {
      title: '剧集',
      key: 'episode',
      width: 180,
      render: (_, record) => `E${String(record.episode_no).padStart(3, '0')} ${record.title}`,
    },
    {
      title: '字幕',
      key: 'subtitle',
      width: 96,
      render: (_, record) => <Tag color={record.subtitle_ready ? 'success' : 'warning'}>{record.subtitle_ready ? '已配置' : '缺失'}</Tag>,
    },
    {
      title: 'AI 状态',
      dataIndex: 'analyze_status',
      width: 110,
      render: (value, record) => (
        <Tooltip title={value === 'failed' ? record.analyze_error : ''}>
          <Tag color={statusColors[value] ?? 'default'}>{value}</Tag>
        </Tooltip>
      ),
    },
    {
      title: '草稿高光',
      dataIndex: 'draft_highlight_count',
      width: 100,
      render: (value) => value ?? 0,
    },
    {
      title: '最近任务',
      key: 'latest_job',
      width: 190,
      render: (_, record) =>
        record.latest_job ? (
          <Space size={6}>
            <Tag color={statusColors[record.latest_job.status] ?? 'default'}>{record.latest_job.status}</Tag>
            <span>{formatDate(record.latest_job.created_at)}</span>
          </Space>
        ) : (
          '-'
        ),
    },
    {
      title: '失败原因',
      key: 'error',
      ellipsis: true,
      render: (_, record) => record.analyze_error || record.latest_job?.error || '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Button
            size="small"
            icon={<RocketOutlined />}
            loading={submittingId === record.id}
            disabled={!record.subtitle_ready}
            onClick={() => submitJob(record)}
          >
            识别
          </Button>
          <Tooltip title="强制重跑">
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={submittingId === record.id}
              disabled={!record.subtitle_ready}
              onClick={() => submitJob(record, true)}
            />
          </Tooltip>
          <Button
            size="small"
            icon={<FileSearchOutlined />}
            disabled={!record.latest_job}
            onClick={() => navigate(`/workspace/analyze/jobs/${record.latest_job.id}`)}
          >
            详情
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <section className="ai-production-page">
      <div className="workflow-overview">
        <div className="workflow-hero">
          <span>AI 生产队列</span>
          <strong>{metrics.pending}</strong>
          <p>待识别剧集</p>
        </div>
        <div className="workflow-metrics">
          <div>
            <span>识别中</span>
            <strong>{metrics.processing}</strong>
          </div>
          <div className="danger">
            <span>识别失败</span>
            <strong>{metrics.failed}</strong>
          </div>
          <div className="warning">
            <span>草稿高光</span>
            <strong>{metrics.draft}</strong>
          </div>
        </div>
      </div>

      <section className="workspace-table-panel">
        <Form form={form} className="production-toolbar" layout="inline" initialValues={filters}>
          <Form.Item name="drama_id" label="短剧">
            <Select
              value={filters.drama_id}
              style={{ width: 180 }}
              options={[{ value: 'all', label: '全部短剧' }, ...dramas.map((item) => ({ value: item.id, label: item.title }))]}
              onChange={(value) => setFilters((current) => ({ ...current, drama_id: value }))}
            />
          </Form.Item>
          <Form.Item name="analyze_status" label="AI 状态">
            <Select
              value={filters.analyze_status}
              style={{ width: 150 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'pending', label: 'pending' },
                { value: 'processing', label: 'processing' },
                { value: 'success', label: 'success' },
                { value: 'failed', label: 'failed' },
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, analyze_status: value }))}
            />
          </Form.Item>
          <Form.Item name="subtitle" label="字幕">
            <Select
              value={filters.subtitle}
              style={{ width: 130 }}
              options={[
                { value: 'all', label: '全部' },
                { value: 'ready', label: '已配置' },
                { value: 'missing', label: '缺失' },
              ]}
              onChange={(value) => setFilters((current) => ({ ...current, subtitle: value }))}
            />
          </Form.Item>
          <Button icon={<ReloadOutlined />} onClick={loadData}>
            刷新
          </Button>
          <Button type="primary" icon={<RocketOutlined />} onClick={() => submitBatch(false)}>
            批量识别
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => submitBatch(true)}>
            失败重跑
          </Button>
        </Form>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }}
          pagination={{ pageSize: 10 }}
          scroll={{ x: 1180 }}
        />
      </section>
    </section>
  );
}

function AnalyzeJobDetail({ jobId }) {
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [logs, setLogs] = useState([]);
  const [episode, setEpisode] = useState(null);
  const [drama, setDrama] = useState(null);
  const [loading, setLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const [jobResponse, logsResponse, dramasResponse, episodesResponse] = await Promise.all([
        apiClient.get(`/api/system/jobs/${jobId}`),
        apiClient.get(`/api/system/jobs/${jobId}/logs`),
        apiClient.get('/api/dramas'),
        apiClient.get('/api/episodes'),
      ]);
      const nextJob = jobResponse.data.data;
      const payload = parsePayload(nextJob.payload_json);
      const nextEpisode = (episodesResponse.data.data ?? []).find((item) => item.id === payload.episode_id);
      const nextDrama = (dramasResponse.data.data ?? []).find((item) => item.id === nextEpisode?.drama_id);
      setJob(nextJob);
      setLogs(logsResponse.data.data ?? []);
      setEpisode(nextEpisode ?? null);
      setDrama(nextDrama ?? null);
    } catch (error) {
      message.error(apiErrorMessage(error, '任务详情加载失败'));
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    Promise.resolve().then(loadDetail);
  }, [loadDetail]);

  if (!job && !loading) {
    return (
      <section className="workspace-table-panel">
        <Empty description="任务不存在或无权限查看" />
      </section>
    );
  }

  const payload = parsePayload(job?.payload_json);

  return (
    <section className="job-detail-page">
      <div className="detail-topbar">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/workspace/analyze')}>
          返回 AI 生产
        </Button>
        <Button icon={<ReloadOutlined />} onClick={loadDetail}>
          刷新
        </Button>
      </div>

      <div className="job-detail-layout">
        <section className="job-detail-card job-detail-summary">
          <span>任务 #{jobId}</span>
          <h2>{drama?.title ?? '未知短剧'}</h2>
          <p>{episode ? `E${String(episode.episode_no).padStart(3, '0')} ${episode.title}` : '剧集信息不可见'}</p>
          {job ? <Tag color={statusColors[job.status] ?? 'default'}>{job.status}</Tag> : null}
          {job ? <Progress percent={Math.round(job.progress ?? 0)} /> : null}
        </section>

        <section className="job-detail-card">
          <h3>生成摘要</h3>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="任务类型">{job?.type ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="Episode ID">{payload.episode_id ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="强制重跑">{payload.force_reanalyze ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="草稿高光">{episode?.draft_highlight_count ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="已发布高光">{episode?.published_highlight_count ?? '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDate(job?.created_at)}</Descriptions.Item>
            <Descriptions.Item label="完成时间">{formatDate(job?.finished_at)}</Descriptions.Item>
          </Descriptions>
          {job?.error ? <Alert type="error" showIcon message={job.error} /> : null}
        </section>

        <section className="job-detail-card job-detail-logs">
          <h3>任务日志</h3>
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            {logs.length ? (
              logs.map((log) => (
                <div className="job-log-line" key={log.id}>
                  <Tag color={log.level === 'error' ? 'error' : 'default'}>{log.level}</Tag>
                  <span>{formatDate(log.created_at)}</span>
                  <strong>{log.message}</strong>
                  {log.context_json && log.context_json !== '{}' ? <pre>{log.context_json}</pre> : null}
                </div>
              ))
            ) : (
              <Empty description="暂无日志" />
            )}
          </Space>
        </section>
      </div>
    </section>
  );
}
