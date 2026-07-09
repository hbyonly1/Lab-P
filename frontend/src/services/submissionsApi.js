import { apiClient } from './apiClient.js';

export async function getMySubmissions() {
  const response = await apiClient.get('/api/v1/submissions/my');
  return response.data;
}

export async function createSelfManagedSubmission(experimentId, imagePaths = []) {
  const response = await apiClient.post('/api/v1/submissions/self-managed', {
    experiment_id: experimentId,
    image_paths: imagePaths,
  });
  return response.data;
}

export async function getReviewPool(params = {}) {
  const response = await apiClient.get('/api/v1/submissions/review-pool', { params });
  return response.data;
}

export async function getSubmission(submissionId) {
  const response = await apiClient.get(`/api/v1/submissions/${submissionId}`);
  return response.data;
}

export async function saveSubmissionImageSlots(submissionId, imageSlots = {}) {
  const response = await apiClient.patch(`/api/v1/submissions/${submissionId}/image-slots`, {
    image_slots: imageSlots,
  });
  return response.data;
}

export async function prepareSubmissionBatchForReview(batchId, assignments = {}) {
  const response = await apiClient.post(`/api/v1/submissions/batches/${batchId}/prepare-review`, {
    assignments,
  });
  return response.data;
}

export async function saveSubmissionCorrection(submissionId, correctedJson, imagePaths = [], saveMode = 'draft', imageSlots = {}) {
  const response = await apiClient.patch(`/api/v1/submissions/${submissionId}/correction`, {
    corrected_json: correctedJson,
    image_paths: imagePaths,
    image_slots: imageSlots,
    save_mode: saveMode,
  });
  return response.data;
}

export async function getSubmissionDraft(submissionId) {
  const response = await apiClient.get(`/api/v1/submissions/${submissionId}/draft`);
  return response.data;
}

export async function saveSubmissionDraft(submissionId, draftJson, imagePaths = [], imageSlots = {}, localRevision = 0) {
  const response = await apiClient.patch(`/api/v1/submissions/${submissionId}/draft`, {
    draft_json: draftJson,
    image_paths: imagePaths,
    image_slots: imageSlots,
    local_revision: localRevision,
  });
  return response.data;
}
