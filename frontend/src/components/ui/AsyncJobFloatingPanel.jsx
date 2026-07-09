import React, { useEffect, useMemo, useState } from 'react';
import { Button, Progress, Tooltip } from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  DownOutlined,
  LoadingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';

function formatElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${seconds % 60} 秒`;
}

function statusIcon(status) {
  if (status === 'succeeded') return <CheckCircleOutlined className="async-job-status-icon is-succeeded" />;
  if (status === 'failed') return <CloseCircleOutlined className="async-job-status-icon is-failed" />;
  return <LoadingOutlined spin className="async-job-status-icon is-running" />;
}

function statusLabel(status) {
  if (status === 'succeeded') return '已完成';
  if (status === 'failed') return '失败';
  return '处理中';
}

export function AsyncJobFloatingPanel({ jobs = [], onDismiss, onClearDone, onRetry, onView }) {
  const [collapsed, setCollapsed] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (jobs.length === 0) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [jobs.length]);

  const visibleJobs = useMemo(
    () => jobs.filter((job) => !job.dismissed),
    [jobs],
  );
  const activeCount = visibleJobs.filter((job) => job.status === 'running' || job.status === 'pending').length;
  const hasFinishedJobs = visibleJobs.some((job) => ['succeeded', 'failed'].includes(job.status));

  useEffect(() => {
    if (visibleJobs.length === 0 || activeCount > 0 || collapsed) return undefined;
    const timer = window.setTimeout(() => setCollapsed(true), 2500);
    return () => window.clearTimeout(timer);
  }, [activeCount, collapsed, visibleJobs.length]);

  useEffect(() => {
    if (activeCount > 0) setCollapsed(false);
  }, [activeCount]);

  if (visibleJobs.length === 0) return null;

  return (
    <aside className={`async-job-floating-panel ${collapsed ? 'is-collapsed' : 'is-expanded'}`} aria-live="polite">
      <button
        className={`async-job-collapsed-button ${activeCount > 0 ? 'is-active' : ''}`}
        type="button"
        aria-label="展开任务"
        onClick={() => setCollapsed(false)}
        tabIndex={collapsed ? 0 : -1}
      >
        <ThunderboltOutlined />
      </button>
      <div className="async-job-expanded-shell" aria-hidden={collapsed}>
          <div className="async-job-floating-header">
            <strong>任务</strong>
            <div className="async-job-floating-actions">
              {hasFinishedJobs && (
                <Tooltip title="清除已结束任务">
                  <Button size="small" type="text" onClick={onClearDone}>
                    清除
                  </Button>
                </Tooltip>
              )}
              <Tooltip title="收起">
                <Button
                  size="small"
                  type="text"
                  icon={<DownOutlined />}
                  onClick={() => setCollapsed(true)}
                />
              </Tooltip>
            </div>
          </div>

          <div className="async-job-list">
            {visibleJobs.map((job) => {
              const isRunning = job.status === 'running' || job.status === 'pending';
              const elapsed = job.startedAt ? formatElapsed(now - job.startedAt) : '';
              const percent = Number.isFinite(job.percent) ? job.percent : (isRunning ? 35 : 100);
              return (
                <div className={`async-job-card is-${job.status}`} key={job.id}>
                  <div className="async-job-card-main">
                    {statusIcon(job.status)}
                    <strong>{job.title}</strong>
                    <span>{statusLabel(job.status)}</span>
                  </div>
                  <div className="async-job-copy">
                    <p>{job.message || job.description || '任务已提交，可继续编辑页面。'}</p>
                    {isRunning && elapsed && (
                      <small>已用时 {elapsed}，可继续编辑其他内容。</small>
                    )}
                    {job.error && <small className="async-job-error">{job.error}</small>}
                  </div>
                  <Progress
                    percent={percent}
                    showInfo={false}
                    status={job.status === 'failed' ? 'exception' : undefined}
                    strokeColor={job.status === 'succeeded' ? '#24a148' : '#1f77ff'}
                  />
                  {(job.status === 'succeeded' && job.viewAction && onView) && (
                    <div className="async-job-card-actions">
                      <Button size="small" type="primary" onClick={() => onView(job)}>
                        {job.viewAction.label || '查看'}
                      </Button>
                    </div>
                  )}
                  {job.status === 'failed' && onRetry && (
                    <div className="async-job-card-actions">
                      <Button size="small" onClick={() => onRetry(job)}>重试</Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
      </div>
    </aside>
  );
}
