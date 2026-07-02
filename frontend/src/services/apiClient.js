import axios from 'axios';
import { clearAdminSession, getAdminAccessToken } from '../auth.js';

export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000',
});

apiClient.interceptors.request.use((config) => {
  const token = getAdminAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    // 401 means invalid/expired token. 403 means Forbidden (like lack of permissions or unpaid), which should be handled by the UI.
    if (status === 401 && window.location.pathname.startsWith('/workspace')) {
      clearAdminSession();
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error, fallback) {
  return error.response?.data?.detail || error.response?.data?.message || error.message || fallback;
}
