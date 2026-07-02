/**
 * Adapter helpers for experiment config returned by the backend.
 * The backend/database is the only source of truth for config_json.
 */
export function buildExperimentConfig(rawConfig) {
  const computedIds = new Set();
  const asyncIds = new Set();
  const fixedIds = new Set();
  const extractIds = new Set();

  const fields = rawConfig?.inputs?.fields || [];

  fields.forEach(f => {
    if (f.type === 'computed') computedIds.add(f.id);
    if (f.type === 'async') asyncIds.add(f.id);
    if (f.type === 'fixed') fixedIds.add(f.id);
    if (f.type === 'extract') extractIds.add(f.id);
  });

  return {
    ...rawConfig,
    metaInfo: {
      computedIds,
      asyncIds,
      fixedIds,
      extractIds,
    },
  };
}

export function initFixedValues(fields = []) {
  const initial = {};
  for (const field of fields) {
    if (field.type === 'fixed' && field.value !== undefined) {
      initial[field.id] = String(field.value);
    } else {
      initial[field.id] = '';
    }
  }
  return initial;
}
