import { apiClient } from './apiClient';

export const recognizeDirect = async (experimentId, imagePaths, submissionId = null, imageRef = null) => {
  const response = await apiClient.post('/api/v1/ai/recognize-direct', {
    experiment_id: experimentId,
    image_paths: imagePaths,
    submission_id: submissionId,
    image_ref: imageRef,
  });
  return response.data;
};

export const generateAnswerDirect = async (experimentId, questions, currentFormValues, submissionId = null) => {
  const response = await apiClient.post('/api/v1/ai/generate-answer-direct', {
    experiment_id: experimentId,
    questions,
    current_form_values: currentFormValues,
    submission_id: submissionId,
  });
  return response.data;
};

export const getFixedFillDirect = async (experimentId, submissionId = null) => {
  const response = await apiClient.post(`/api/v1/ai/fixed-fill/${experimentId}`, {
    submission_id: submissionId,
  });
  return response.data;
};

export const getTaskStatus = async (taskId) => {
  const response = await apiClient.get(`/api/v1/ai/task/${taskId}`);
  return response.data;
};

export const triggerSubmissionRecognition = async (submissionId) => {
  const response = await apiClient.post(`/api/v1/ai/recognize/${submissionId}`);
  return response.data;
};

export const getAiConfig = async () => {
  const response = await apiClient.get('/api/v1/ai/admin/config');
  return response.data;
};

export const updateAiConfig = async (configData) => {
  const response = await apiClient.put('/api/v1/ai/admin/config', configData);
  return response.data;
};

export const updateAiTaskOverrides = async (taskOverridesJson) => {
  const response = await apiClient.put('/api/v1/ai/admin/task-overrides', {
    task_overrides_json: taskOverridesJson,
  });
  return response.data;
};

export const testAiConnection = async () => {
  const response = await apiClient.post('/api/v1/ai/admin/test-connection');
  return response.data;
};

export const getAiPromptTemplate = async (experimentId) => {
  const response = await apiClient.get(`/api/v1/ai/admin/prompts/${experimentId}`);
  return response.data;
};

export const updateAiPromptTemplate = async (experimentId, promptData) => {
  const response = await apiClient.put(`/api/v1/ai/admin/prompts/${experimentId}`, promptData);
  return response.data;
};

export const previewAiPromptTemplate = async (experimentId, promptData) => {
  const response = await apiClient.post(`/api/v1/ai/admin/prompts/${experimentId}/preview`, promptData);
  return response.data;
};

export const autoMatchExperimentImagesTask = async (images, experimentIds = []) => {
  const response = await apiClient.post('/api/v1/ai/experiment-image-auto-match-task', {
    images,
    experiment_ids: experimentIds,
  });
  return response.data;
};

export const previewExperimentImageAutoMatchPrompt = async () => {
  const response = await apiClient.get('/api/v1/ai/admin/experiment-image-auto-match/preview');
  return response.data;
};
