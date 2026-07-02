import { apiClient } from './apiClient.js';

function normalizeAuthSession(payload) {
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    username: payload.username || 'user', // Note: we didn't return username from backend, so we might need to rely on what was typed
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
  
  const payload = response.data;
  payload.username = credentials.username; // Attach it back since backend didn't return it
  return normalizeAuthSession(payload);
}

export async function logoutAdmin() {
  // For JWT, logout is purely client-side by clearing the token
  return Promise.resolve();
}

export async function getMe() {
  const response = await apiClient.get('/api/v1/auth/me');
  return response.data;
}
