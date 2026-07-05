import { apiClient } from './apiClient.js';

export async function getMySubmissions() {
  const response = await apiClient.get('/api/v1/submissions/my');
  return response.data;
}

export async function submitExperiment(experimentId, targetStudent = null, isHungup = false, imagePaths = [], planName = 'pay_per_use') {
  const payload = { experiment_id: experimentId, is_hungup: isHungup, image_paths: imagePaths, plan: planName };
  if (targetStudent) {
    payload.target_student = targetStudent;
  }
  const response = await apiClient.post('/api/v1/submissions/submit', payload);
  return response.data;
}

export async function createSelfManagedSubmission(experimentId, imagePaths = []) {
  const response = await apiClient.post('/api/v1/submissions/self-managed', {
    experiment_id: experimentId,
    image_paths: imagePaths,
  });
  return response.data;
}

export async function getReviewPool() {
  const response = await apiClient.get('/api/v1/submissions/review-pool');
  return response.data;
}

export async function approveSubmission(submissionId) {
  const response = await apiClient.post(`/api/v1/submissions/${submissionId}/approve`);
  return response.data;
}

export async function getSubmission(submissionId) {
  const response = await apiClient.get(`/api/v1/submissions/${submissionId}`);
  return response.data;
}

export async function saveSubmissionCorrection(submissionId, correctedJson, imagePaths = [], saveMode = 'draft') {
  const response = await apiClient.patch(`/api/v1/submissions/${submissionId}/correction`, {
    corrected_json: correctedJson,
    image_paths: imagePaths,
    save_mode: saveMode,
  });
  return response.data;
}
