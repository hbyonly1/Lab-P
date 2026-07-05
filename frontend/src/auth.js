export const ACCESS_TOKEN_KEY = 'physics_report_access_token';
export const USER_NAME_KEY = 'physics_report_user_name';
export const USER_STUDENT_NO_KEY = 'physics_report_student_no';
export const USER_PLATFORM_USERNAME_KEY = 'physics_report_platform_username';
export const USER_ROLE_KEY = 'physics_report_user_role';
export const AUTH_SESSION_CHANGED_EVENT = 'physics_report_auth_session_changed';

function notifyAuthSessionChanged() {
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CHANGED_EVENT));
}

export function subscribeAuthSessionChanged(listener) {
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, listener);
  return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, listener);
}

export function hasAdminAccessToken() {
  return Boolean(window.localStorage.getItem(ACCESS_TOKEN_KEY));
}

export function getAdminAccessToken() {
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function saveAdminAccessToken(token) {
  window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
  notifyAuthSessionChanged();
}

export function saveAdminUserName(userName) {
  if (userName) {
    window.localStorage.setItem(USER_NAME_KEY, userName);
  } else {
    window.localStorage.removeItem(USER_NAME_KEY);
  }
  notifyAuthSessionChanged();
}

export function saveAdminStudentNo(studentNo) {
  if (studentNo) {
    window.localStorage.setItem(USER_STUDENT_NO_KEY, studentNo);
  } else {
    window.localStorage.removeItem(USER_STUDENT_NO_KEY);
  }
  notifyAuthSessionChanged();
}

export function saveAdminPlatformUsername(username) {
  if (username) {
    window.localStorage.setItem(USER_PLATFORM_USERNAME_KEY, username);
  } else {
    window.localStorage.removeItem(USER_PLATFORM_USERNAME_KEY);
  }
  notifyAuthSessionChanged();
}

export function saveAdminUserRole(role) {
  window.localStorage.setItem(USER_ROLE_KEY, role);
  notifyAuthSessionChanged();
}

export function saveAdminSession(session) {
  saveAdminAccessToken(session.accessToken);
  saveAdminUserName(session.realName);
  saveAdminStudentNo(session.studentNo);
  saveAdminPlatformUsername(session.username);
  saveAdminUserRole(session.role);
}

export function getAdminUserName() {
  return window.localStorage.getItem(USER_NAME_KEY) || '';
}

export function getAdminStudentNo() {
  return window.localStorage.getItem(USER_STUDENT_NO_KEY) || '';
}

export function getAdminPlatformUsername() {
  return window.localStorage.getItem(USER_PLATFORM_USERNAME_KEY) || '';
}

export function getAdminUserRole() {
  return window.localStorage.getItem(USER_ROLE_KEY) || '';
}

export function clearAdminSession() {
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(USER_NAME_KEY);
  window.localStorage.removeItem(USER_STUDENT_NO_KEY);
  window.localStorage.removeItem(USER_PLATFORM_USERNAME_KEY);
  window.localStorage.removeItem(USER_ROLE_KEY);
  notifyAuthSessionChanged();
}
