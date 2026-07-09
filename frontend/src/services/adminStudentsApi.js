import { apiClient } from './apiClient.js';

export async function getAdminStudents(params = {}) {
  const response = await apiClient.get('/api/v1/admin/students', { params });
  return response.data;
}

export async function getAdminStudentExperiments(studentId) {
  const response = await apiClient.get(`/api/v1/admin/students/${studentId}/experiments`);
  return response.data;
}

export async function createAdminStudent({ studentNo, password }) {
  const response = await apiClient.post('/api/v1/admin/students', {
    studentNo,
    password,
  });
  return response.data;
}

export async function syncAdminStudentOverview(studentId, options = {}) {
  const response = await apiClient.post(`/api/v1/admin/students/${studentId}/sync-overview`, {
    closeSessionAfterFinish: options.closeSessionAfterFinish === true,
  });
  return response.data;
}

export async function ensureAdminStudentEditSubmission(studentId, experimentId) {
  const response = await apiClient.post(`/api/v1/admin/students/${studentId}/experiments/${experimentId}/edit-submission`);
  return response.data;
}

export async function checkAdminStudentCompletion(studentId) {
  const response = await apiClient.post(`/api/v1/admin/students/${studentId}/completion-check`);
  return response.data;
}

export async function getAdminStudentCompletionCheckResult(studentId, jobId) {
  const response = await apiClient.get(`/api/v1/admin/students/${studentId}/completion-check/${jobId}`);
  return response.data;
}

export async function captureAdminStudentSubmissionScreenshots(studentId) {
  const response = await apiClient.post(`/api/v1/admin/students/${studentId}/submission-screenshots`);
  return response.data;
}

export async function getAdminStudentSubmissionScreenshotsResult(studentId, jobId) {
  const response = await apiClient.get(`/api/v1/admin/students/${studentId}/submission-screenshots/${jobId}`);
  return response.data;
}

export async function getAdminStudentSubmissionScreenshotBlob(studentId, jobId, experimentId) {
  const response = await apiClient.get(
    `/api/v1/admin/students/${studentId}/submission-screenshots/${jobId}/files/${experimentId}`,
    { responseType: 'blob' },
  );
  return response.data;
}

export async function finalSubmitAdminStudentDrafts(studentId) {
  const response = await apiClient.post(`/api/v1/admin/students/${studentId}/final-submit-drafts`);
  return response.data;
}
