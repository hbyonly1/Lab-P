import { apiClient } from './apiClient.js';

export async function submitFeedback({ contact_info, description }) {
  const response = await apiClient.post('/api/v1/feedback/', { contact_info, description });
  return response.data;
}

export async function getFeedbacks() {
  const response = await apiClient.get('/api/v1/feedback/');
  return response.data;
}

export async function getFeedbackStats() {
  const response = await apiClient.get('/api/v1/feedback/stats');
  return response.data;
}
