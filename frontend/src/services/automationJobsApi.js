import { apiClient } from './apiClient.js';

export async function getAutomationJob(jobId) {
  const response = await apiClient.get(`/api/v1/automation-jobs/${jobId}`);
  return response.data;
}

export async function getActiveAutomationJobs(params = {}) {
  const response = await apiClient.get('/api/v1/automation-jobs/active', { params });
  return response.data;
}
