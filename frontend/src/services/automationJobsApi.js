import { apiClient } from './apiClient.js';

export async function getAutomationJob(jobId) {
  const response = await apiClient.get(`/api/v1/automation-jobs/${jobId}`);
  return response.data;
}

export async function getActiveAutomationJobs(params = {}) {
  const response = await apiClient.get('/api/v1/automation-jobs/active', { params });
  return response.data;
}

export async function cancelAutomationJob(jobId) {
  const response = await apiClient.post(`/api/v1/automation-jobs/${jobId}/cancel`);
  return response.data;
}

export async function getAutomationJobScreenshotBlob(jobId) {
  const response = await apiClient.get(`/api/v1/automation-jobs/${jobId}/screenshot`, {
    responseType: 'blob',
  });
  return response.data;
}

export async function getSchoolBrowserSessions() {
  const response = await apiClient.get('/api/v1/automation-jobs/school-browser-sessions');
  return response.data;
}

export async function closeSchoolBrowserSession(userId) {
  const response = await apiClient.delete(`/api/v1/automation-jobs/school-browser-sessions/${userId}`);
  return response.data;
}

export async function closeAllSchoolBrowserSessions() {
  const response = await apiClient.delete('/api/v1/automation-jobs/school-browser-sessions');
  return response.data;
}

export async function restartBackendService() {
  const response = await apiClient.post('/api/v1/automation-jobs/backend/restart');
  return response.data;
}
