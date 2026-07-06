import { useCallback, useState } from 'react';
import { getTaskStatus } from '../services/aiApi.js';
import { getAsyncTaskProgressStage } from './asyncTaskProgressProfiles.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_SECONDS = 180;

function timeoutMessage(taskId, timeoutSeconds) {
  return `前端已等待 ${timeoutSeconds} 秒仍未收到完成状态。后台任务可能仍在运行，请稍后查看日志或重试。任务 ID: ${taskId}`;
}

export function useAsyncTaskRunner({ maxVisibleJobs = 5 } = {}) {
  const [jobs, setJobs] = useState([]);

  const upsertJob = useCallback((job) => {
    setJobs((prev) => {
      const nextJob = { ...job };
      const exists = prev.some((item) => item.id === nextJob.id);
      if (!exists) return [nextJob, ...prev].slice(0, maxVisibleJobs);
      return prev.map((item) => (item.id === nextJob.id ? { ...item, ...nextJob } : item));
    });
  }, [maxVisibleJobs]);

  const startJob = useCallback((id, payload) => {
    upsertJob({
      id,
      status: 'running',
      percent: 15,
      startedAt: Date.now(),
      ...payload,
    });
  }, [upsertJob]);

  const finishJob = useCallback((id, payload = {}) => {
    upsertJob({
      id,
      status: 'succeeded',
      percent: 100,
      message: '任务完成，结果已写入页面，请核对。',
      ...payload,
    });
  }, [upsertJob]);

  const failJob = useCallback((id, payload = {}) => {
    upsertJob({
      id,
      status: 'failed',
      percent: 100,
      message: '任务处理失败',
      ...payload,
    });
  }, [upsertJob]);

  const dismissJob = useCallback((jobId) => {
    setJobs((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  const clearFinishedJobs = useCallback(() => {
    setJobs((prev) => prev.filter((job) => !['succeeded', 'failed'].includes(job.status)));
  }, []);

  const pollCeleryTask = useCallback(async ({
    taskId,
    jobId,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutSeconds = DEFAULT_POLL_TIMEOUT_SECONDS,
    onSuccess,
    onProgress,
    progressProfile,
  }) => new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      if (elapsedSeconds > pollTimeoutSeconds) {
        window.clearInterval(timer);
        reject(new Error(timeoutMessage(taskId, pollTimeoutSeconds)));
        return;
      }

      try {
        const res = await getTaskStatus(taskId);
        if (res.status === 'done') {
          window.clearInterval(timer);
          onSuccess?.(res.result);
          resolve(res.result);
          return;
        }
        if (res.status === 'error') {
          window.clearInterval(timer);
          reject(new Error(res.message || '处理失败'));
          return;
        }
        const attempts = Math.max(1, Math.floor(elapsedSeconds / (pollIntervalMs / 1000)));
        const progressStage = getAsyncTaskProgressStage(progressProfile, elapsedSeconds);
        if (progressStage) {
          upsertJob({
            id: jobId,
            status: 'running',
            percent: progressStage.percent,
            message: progressStage.message,
          });
        }
        onProgress?.(res, attempts, elapsedSeconds);
      } catch (err) {
        window.clearInterval(timer);
        reject(err);
      }
    }, pollIntervalMs);

    upsertJob({
      id: jobId,
      backendTaskId: taskId,
      pollTimeoutSeconds,
    });
  }), [upsertJob]);

  const runCeleryTask = useCallback(async ({
    jobId,
    title,
    description,
    startMessage,
    startPercent,
    progressProfile,
    request,
    onSuccess,
    onFailure,
    onProgress,
    successMessage,
    failureMessage = '任务处理失败。',
  }) => {
    const initialStage = getAsyncTaskProgressStage(progressProfile, 0);
    startJob(jobId, {
      title,
      description,
      message: startMessage || initialStage?.message || '任务已提交...',
      percent: startPercent || initialStage?.percent || 18,
    });

    try {
      const queued = await request();
      const result = await pollCeleryTask({
        taskId: queued.task_id,
        jobId,
        pollIntervalMs: queued.poll_interval_ms || DEFAULT_POLL_INTERVAL_MS,
        pollTimeoutSeconds: queued.poll_timeout_seconds || DEFAULT_POLL_TIMEOUT_SECONDS,
        onSuccess,
        onProgress,
        progressProfile,
      });
      finishJob(jobId, {
        message: typeof successMessage === 'function' ? successMessage(result) : successMessage,
      });
      return result;
    } catch (err) {
      failJob(jobId, {
        message: failureMessage,
        error: err.response?.data?.detail || err.message,
      });
      onFailure?.(err);
      throw err;
    }
  }, [failJob, finishJob, pollCeleryTask, startJob]);

  return {
    jobs,
    upsertJob,
    startJob,
    finishJob,
    failJob,
    dismissJob,
    clearFinishedJobs,
    runCeleryTask,
  };
}
