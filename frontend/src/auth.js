export const ACCESS_TOKEN_KEY = 'physics_report_access_token';
export const USER_NAME_KEY = 'physics_report_user_name';
export const USER_ROLE_KEY = 'physics_report_user_role';

export function hasAdminAccessToken() {
  return Boolean(window.localStorage.getItem(ACCESS_TOKEN_KEY));
}

export function getAdminAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveAdminAccessToken(token) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function saveAdminUserName(userName) {
  window.localStorage.setItem(USER_NAME_KEY, userName);
}

export function saveAdminUserRole(role) {
  window.localStorage.setItem(USER_ROLE_KEY, role);
}

export function saveAdminSession(session) {
  saveAdminAccessToken(session.accessToken);
  saveAdminUserName(session.username);
  saveAdminUserRole(session.role);
}

export function getAdminUserName() {
  return window.localStorage.getItem(USER_NAME_KEY) || 'user';
}

export function getAdminUserRole() {
  return window.localStorage.getItem(USER_ROLE_KEY) || '';
}

export function clearAdminSession() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(USER_NAME_KEY);
  window.localStorage.removeItem(USER_ROLE_KEY);
}
