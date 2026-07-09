import { useCallback, useState } from 'react';
import { getTaskStatus } from '../services/aiApi.js';
import { getAutomationJob } from '../services/automationJobsApi.js';
import { renderAutomationMessage } from '../constants/automationMessages.js';
import { getAsyncTaskProgressStage } from './asyncTaskProgressProfiles.js';
import { getApiErrorMessage } from '../utils/apiErrorUtils.js';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_TIMEOUT_SECONDS = 180;
const DEFAULT_AUTOMATION_POLL_INTERVAL_MS = 800;
const DEFAULT_AUTOMATION_POLL_TIMEOUT_SECONDS = 900;

function normalizeAutomationStep(messageCode, stepAliases = {}) {
  if (['school.submit.submittingDraft', 'school.submit.submittingFinal'].includes(messageCode)) {
    return 'school.submit.submitAction';
  }
  if (messageCode === 'school.submit.returningList') {
    return 'school.submit.readingStatus';
  }
  return stepAliases[messageCode] || messageCode;
}

function automationPercent(messageCode, steps = [], stepAliases = {}) {
  if (!Array.isArray(steps) || steps.length === 0) return 45;
  const index = steps.indexOf(normalizeAutomationStep(messageCode, stepAliases));
  if (index < 0) return 35;
  return Math.min(92, Math.max(12, Math.round(((index + 1) / steps.length) * 90)));
}

function timeoutMessage(taskId, timeoutSeconds) {
  return `前端已等待 ${timeoutSeconds} 秒仍未收到完成状态。后台任务可能仍在运行，请稍后查看日志或重试。任务 ID: ${taskId}`;
}

function automationTimeoutMessage(jobId, timeoutSeconds) {
  return `前端已等待 ${timeoutSeconds} 秒仍未收到学校系统任务完成状态。后台任务可能仍在运行，请稍后查看日志或刷新页面。任务 ID: ${jobId}`;
}

function automationPollErrorMessage(error) {
  if (!error?.response && String(error?.message || '').toLowerCase().includes('network')) {
    return '无法连接后端，可能是后端正在重启、服务不可达，或本次连接已断开。请到「自动化任务」页面查看活跃任务并手动终止。';
  }
  const baseMessage = getApiErrorMessage(error, error?.message || '学校系统任务轮询失败');
  const diagnostic = error?.diagnosticSummary || error?.automationJob?.messageParams?.diagnosticSummary;
  if (!diagnostic?.failedFields?.length) return baseMessage;
  const fields = diagnostic.failedFields
    .slice(0, 6)
    .map((item) => {
      const node = item.nodeId || item.selector || '未知节点';
      const reason = item.reason || item.stage || '写入失败';
      const detail = item.error ? `：${item.error}` : '';
      return `${node} ${reason}${detail}`;
    })
    .join('；');
  const suffix = diagnostic.failedCount > 6 ? `；另有 ${diagnostic.failedCount - 6} 项` : '';
  return `${baseMessage}。失败节点：${fields}${suffix}`;
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
        if (res.status === 'progress') {
          upsertJob({
            id: jobId,
            status: 'running',
            percent: Number.isFinite(Number(res.percent)) ? Number(res.percent) : 45,
            message: res.message || '任务正在处理中...',
          });
          onProgress?.(res, attempts, elapsedSeconds);
          return;
        }
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

  const pollAutomationJob = useCallback(async ({
    job,
    jobId,
    floatingJobId,
    steps,
    stepAliases,
    pollIntervalMs = DEFAULT_AUTOMATION_POLL_INTERVAL_MS,
    pollTimeoutSeconds = DEFAULT_AUTOMATION_POLL_TIMEOUT_SECONDS,
    onSuccess,
    onProgress,
  }) => new Promise((resolve, reject) => {
    const automationJobId = jobId || job?.jobId;
    if (!automationJobId) {
      reject(new Error('缺少学校系统任务 ID'));
      return;
    }

    const startedAt = Date.now();
    const tick = async () => {
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      if (elapsedSeconds > pollTimeoutSeconds) {
        reject(new Error(automationTimeoutMessage(automationJobId, pollTimeoutSeconds)));
        return false;
      }

      const fresh = await getAutomationJob(automationJobId);
      onProgress?.(fresh, elapsedSeconds);
      if (fresh.status === 'succeeded') {
        onSuccess?.(fresh);
        resolve(fresh);
        return false;
      }
      if (fresh.status === 'failed') {
        const error = new Error(renderAutomationMessage(fresh.messageCode, fresh.messageParams) || '学校系统任务失败');
        error.automationJob = fresh;
        error.diagnosticSummary = fresh.messageParams?.diagnosticSummary;
        reject(error);
        return false;
      }
      upsertJob({
        id: floatingJobId,
        status: 'running',
        percent: automationPercent(fresh.messageCode, steps, stepAliases),
        message: renderAutomationMessage(fresh.messageCode, fresh.messageParams) || '学校系统任务正在处理中...',
      });
      return true;
    };

    let timer = null;
    const runTick = async () => {
      try {
        const shouldContinue = await tick();
        if (!shouldContinue && timer) window.clearInterval(timer);
      } catch (err) {
        if (timer) window.clearInterval(timer);
        reject(err);
      }
    };

    timer = window.setInterval(runTick, pollIntervalMs);
    runTick();
  }), [upsertJob]);

  const runAutomationJob = useCallback(async ({
    job,
    jobId,
    jobKey,
    title,
    description,
    steps,
    stepAliases,
    startMessage,
    successMessage = '学校系统任务已完成。',
    failureMessage = '学校系统任务失败。',
    onSuccess,
    onFailure,
    onProgress,
    viewAction,
  }) => {
    const automationJobId = jobId || job?.jobId;
    const floatingJobId = jobKey || `automation-${automationJobId}`;
    startJob(floatingJobId, {
      title,
      description,
      backendTaskId: automationJobId,
      message: startMessage || renderAutomationMessage(job?.messageCode, job?.messageParams) || '学校系统任务已提交...',
      percent: automationPercent(job?.messageCode, steps, stepAliases),
    });

    try {
      const result = await pollAutomationJob({
        job,
        jobId: automationJobId,
        floatingJobId,
        steps,
        stepAliases,
        onSuccess,
        onProgress,
      });
      finishJob(floatingJobId, {
        message: typeof successMessage === 'function' ? successMessage(result) : successMessage,
        viewAction,
      });
      return result;
    } catch (err) {
      const errorMessage = automationPollErrorMessage(err);
      failJob(floatingJobId, {
        message: failureMessage,
        error: errorMessage,
      });
      onFailure?.(err);
      throw err;
    }
  }, [failJob, finishJob, pollAutomationJob, startJob]);

  return {
    jobs,
    upsertJob,
    startJob,
    finishJob,
    failJob,
    dismissJob,
    clearFinishedJobs,
    runCeleryTask,
    runAutomationJob,
  };
}
