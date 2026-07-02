import { apiClient } from './apiClient';

export const getAutomationConfig = async () => {
  const response = await apiClient.get('/api/v1/admin/automation-config');
  return response.data;
};

export const updateAutomationConfig = async (payload) => {
  const response = await apiClient.patch('/api/v1/admin/automation-config', payload);
  return response.data;
};
