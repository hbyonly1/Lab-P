import { apiClient } from './apiClient.js';

export const experimentsApi = {
  listExperiments: async () => {
    const response = await apiClient.get('/api/v1/experiments');
    return response.data;
  },

  refreshExperimentConfigs: async () => {
    const response = await apiClient.post('/api/v1/experiments/refresh-configs');
    return response.data;
  },

  getExperimentConfig: async (experimentId) => {
    const response = await apiClient.get(`/api/v1/experiments/${experimentId}`);
    return response.data.config_json;
  },

  getExperimentRawConfig: async (experimentId) => {
    const response = await apiClient.get(`/api/v1/experiments/${experimentId}/raw-config`);
    return response.data;
  },

  updateExperimentRawConfig: async (experimentId, configJson) => {
    const response = await apiClient.patch(`/api/v1/experiments/${experimentId}/raw-config`, {
      config_json: configJson
    });
    return response.data;
  },

  computeExperimentData: async (experimentId, currentFormValues, submissionId = null) => {
    const response = await apiClient.post(`/api/v1/experiments/${experimentId}/compute`, {
      current_form_values: currentFormValues,
      submission_id: submissionId
    });
    return response.data;
  },
  
  getExperimentFormulas: async (experimentId) => {
    const response = await apiClient.get(`/api/v1/experiments/${experimentId}/formulas`);
    return response.data;
  },
  
  updateExperimentFormulas: async (experimentId, formulas) => {
    const response = await apiClient.put(`/api/v1/experiments/${experimentId}/formulas`, {
      formulas: formulas
    });
    return response.data;
  }
};
