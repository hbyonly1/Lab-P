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

export async function startSchoolExperimentSubmit(experimentId, { submissionId, mode }) {
  const response = await apiClient.post(`/api/v1/school-sync/experiments/${experimentId}/submit`, {
    submissionId,
    mode,
  });
  return response.data;
}
