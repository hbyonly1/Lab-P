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
    if ((status === 401 || status === 403) && window.location.pathname.startsWith('/workspace')) {
      clearAdminSession();
      window.location.assign('/login');
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error, fallback) {
  return error.response?.data?.detail || error.response?.data?.message || error.message || fallback;
}
