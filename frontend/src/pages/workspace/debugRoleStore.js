const DEBUG_SERVICE_ROLE_KEY = 'labflow.debugServiceRole';
export const DEFAULT_DEBUG_SERVICE_ROLE = 'free';

export const debugServiceRoles = [
  { value: 'free', label: 'Free' },
  { value: 'plus', label: 'Plus' },
  { value: 'pro', label: 'Pro' },
];

export function getDebugServiceRole() {
  const value = window.localStorage.getItem(DEBUG_SERVICE_ROLE_KEY);
  return debugServiceRoles.some((role) => role.value === value) ? value : DEFAULT_DEBUG_SERVICE_ROLE;
}

export function saveDebugServiceRole(role) {
  if (!debugServiceRoles.some((item) => item.value === role)) return;
  window.localStorage.setItem(DEBUG_SERVICE_ROLE_KEY, role);
  window.dispatchEvent(new CustomEvent('labflow-debug-service-role-change', { detail: role }));
}

export function subscribeDebugServiceRole(listener) {
  const handleRoleChange = () => listener(getDebugServiceRole());
  const handleStorage = (event) => {
    if (event.key === DEBUG_SERVICE_ROLE_KEY) {
      listener(getDebugServiceRole());
    }
  };

  window.addEventListener('labflow-debug-service-role-change', handleRoleChange);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener('labflow-debug-service-role-change', handleRoleChange);
    window.removeEventListener('storage', handleStorage);
  };
}

export function getDebugServiceCapabilities(role = getDebugServiceRole()) {
  return {
    canUseAssistedFill: role === 'plus' || role === 'pro',
    canUseRecognition: role === 'plus' || role === 'pro',
    canUseOneClickSubmit: role === 'pro',
  };
}
