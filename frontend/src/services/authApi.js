import { apiClient } from './apiClient.js';

function normalizeAuthSession(payload) {
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    username: payload.username || '',
    studentNo: payload.student_no,
    realName: payload.real_name,
    role: payload.role,
    capabilities: payload.capabilities || {}
  };
}

export async function loginAdmin(credentials) {
  const formData = new URLSearchParams();
  formData.append('username', credentials.username);
  formData.append('password', credentials.password);

  const response = await apiClient.post('/api/v1/auth/login', formData, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  });
  
  return normalizeAuthSession(response.data);
}

export async function logoutAdmin() {
  // For JWT, logout is purely client-side by clearing the token
  return Promise.resolve();
}

export async function getMe() {
  const response = await apiClient.get('/api/v1/auth/me');
  return response.data;
}
