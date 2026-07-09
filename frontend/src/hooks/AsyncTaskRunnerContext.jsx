import React, { createContext, useContext, useState } from 'react';
import { message } from 'antd';
import { AsyncJobFloatingPanel } from '../components/ui/index.js';
import { useAsyncTaskRunner } from './useAsyncTaskRunner.js';
import { SchoolCompletionResultModal } from '../components/school/SchoolAutomationResultModals.jsx';
import { getSchoolCompletionCheckResult } from '../services/schoolSyncApi.js';
import { getAdminStudentCompletionCheckResult } from '../services/adminStudentsApi.js';
import { getApiErrorMessage } from '../utils/apiErrorUtils.js';

const AsyncTaskRunnerContext = createContext(null);

export function AsyncTaskRunnerProvider({ children }) {
  const runner = useAsyncTaskRunner({ maxVisibleJobs: 5 });
  const [completionResultOpen, setCompletionResultOpen] = useState(false);
  const [completionResultLoading, setCompletionResultLoading] = useState(false);
  const [completionResult, setCompletionResult] = useState(null);
  const [completionResultTitle, setCompletionResultTitle] = useState('学校系统填空完整性检查');

  const handleViewJob = async (job) => {
    const action = job?.viewAction || {};
    if (action.type !== 'schoolCompletionResult') return;
    const jobId = action.jobId || job.backendTaskId;
    if (!jobId) {
      message.error('缺少完整性检查任务 ID');
      return;
    }
    setCompletionResultTitle(action.title || job.title || '学校系统填空完整性检查');
    setCompletionResultOpen(true);
    setCompletionResultLoading(true);
    try {
      const result = action.studentId
        ? await getAdminStudentCompletionCheckResult(action.studentId, jobId)
        : await getSchoolCompletionCheckResult(jobId);
      setCompletionResult(result);
    } catch (error) {
      message.error(getApiErrorMessage(error, '读取完整性检查结果失败'));
    } finally {
      setCompletionResultLoading(false);
    }
  };

  return (
    <AsyncTaskRunnerContext.Provider value={runner}>
      {children}
      <AsyncJobFloatingPanel
        jobs={runner.jobs}
        onDismiss={runner.dismissJob}
        onClearDone={runner.clearFinishedJobs}
        onView={handleViewJob}
      />
      <SchoolCompletionResultModal
        open={completionResultOpen}
        result={completionResult}
        loading={completionResultLoading}
        title={completionResultTitle}
        onClose={() => setCompletionResultOpen(false)}
      />
    </AsyncTaskRunnerContext.Provider>
  );
}

export function useWorkspaceAsyncTaskRunner() {
  return useContext(AsyncTaskRunnerContext);
}
