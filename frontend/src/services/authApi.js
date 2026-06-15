import { apiClient } from './apiClient.js';

function normalizeAuthSession(payload) {
  const user = payload.user ?? {
    id: payload.user_id,
    username: payload.username,
    role: payload.role,
  };

  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type,
    expiresIn: payload.expires_in,
    user,
    username: user.username,
    role: user.role,
  };
}

export async function loginAdmin(credentials) {
  const response = await apiClient.post('/api/auth/login', credentials);
  return normalizeAuthSession(response.data.data);
}

export async function logoutAdmin() {
  await apiClient.post('/api/auth/logout');
}
