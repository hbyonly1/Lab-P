import { apiClient } from './apiClient.js';

export const auditApi = {
  getAuditLogs: async () => {
    const response = await apiClient.get('/api/v1/audit/logs');
    return response.data;
  },
  getMyAuditLogs: async () => {
    const response = await apiClient.get('/api/v1/audit/my_logs');
    return response.data;
  },
  logAction: async (data) => {
    const response = await apiClient.post('/api/v1/audit/log_action', data);
    return response.data;
  }
};
