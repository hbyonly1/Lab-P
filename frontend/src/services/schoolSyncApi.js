import { apiClient } from './apiClient.js';

export async function getSchoolOverviewLatest() {
  const response = await apiClient.get('/api/v1/school-sync/overview/latest');
  return response.data;
}

export async function startSchoolOverviewSync({ force = false } = {}) {
  const response = await apiClient.post('/api/v1/school-sync/overview', { force });
  return response.data;
}

export async function startSchoolExperimentDetailSync(experimentId) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}`);
  return response.data;
}

export async function startSchoolSubmissionExperimentDetailSync(experimentId, submissionId) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}/submissions/${submissionId}`);
  return response.data;
}

export async function startSchoolExperimentReportScreenshot(experimentId) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}/screenshot`);
  return response.data;
}

export async function startSchoolCompletionCheck() {
  const response = await apiClient.post('/api/v1/school-sync/completion-check');
  return response.data;
}

export async function startSchoolExperimentCompletionCheck(experimentId) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}/completion-check`);
  return response.data;
}

export async function getSchoolCompletionCheckResult(jobId) {
  const response = await apiClient.get(`/api/v1/school-sync/completion-check/${jobId}`);
  return response.data;
}

export async function startSchoolSubmissionScreenshots() {
  const response = await apiClient.post('/api/v1/school-sync/submission-screenshots');
  return response.data;
}

export async function getSchoolSubmissionScreenshotsResult(jobId) {
  const response = await apiClient.get(`/api/v1/school-sync/submission-screenshots/${jobId}`);
  return response.data;
}

export async function getSchoolSubmissionScreenshotBlob(jobId, experimentId) {
  const response = await apiClient.get(`/api/v1/school-sync/submission-screenshots/${jobId}/files/${experimentId}`, {
    responseType: 'blob',
  });
  return response.data;
}

export async function startSchoolSubmissionExperimentReportScreenshot(experimentId, submissionId) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}/submissions/${submissionId}/screenshot`);
  return response.data;
}

export async function getSchoolSyncSettings() {
  const response = await apiClient.get('/api/v1/school-sync/settings');
  return response.data;
}

export async function getSchoolExperimentDetailLatest(experimentId) {
  const response = await apiClient.get(`/api/v1/school-sync/experiments/${experimentId}/latest`);
  return response.data;
}

export async function getSchoolSubmissionExperimentDetailLatest(experimentId, submissionId) {
  const response = await apiClient.get(`/api/v1/school-sync/experiments/${experimentId}/submissions/${submissionId}/latest`);
  return response.data;
}

export async function startSchoolExperimentSubmit(experimentId, { submissionId, mode }) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}/submit`, {
    submissionId,
    mode,
  });
  return response.data;
}
