import defaultExperimentConfig from '@labflow-assets/data.json';

const STORAGE_KEY = 'labflow.experimentProfiles';

function hashText(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function normalizeExperimentProfiles(payload) {
  if (payload?.expName) {
    return [{
      id: `exp-${hashText(payload.expName)}`,
      key: payload.expName,
      name: payload.expName,
      profile: payload,
    }];
  }

  const profiles = payload?.profiles && typeof payload.profiles === 'object'
    ? payload.profiles
    : payload;

  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) {
    throw new Error('JSON 需要包含 profiles 对象，或直接是实验配置对象。');
  }

  return Object.entries(profiles).map(([key, profile], index) => {
    const config = profile && typeof profile === 'object' ? profile : {};
    const name = config.expName || key || `实验 ${index + 1}`;

    return {
      id: `exp-${hashText(`${key}-${name}-${index}`)}`,
      key,
      name,
      profile: config,
    };
  });
}

export function loadExperimentProfiles() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : normalizeExperimentProfiles(defaultExperimentConfig);
  } catch {
    return normalizeExperimentProfiles(defaultExperimentConfig);
  }
}

export function saveExperimentProfiles(profiles) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function findExperimentProfile(id) {
  return loadExperimentProfiles().find((profile) => profile.id === id);
}

function normalizeUploadSourceGroups(source) {
  if (!Array.isArray(source)) return [];
  const groups = Array.isArray(source[0]) ? source : [source];
  return groups
    .map((group) => group.filter(Boolean))
    .filter((group) => group.length > 0);
}

function expandNodePattern(pattern) {
  const match = String(pattern).match(/^(.*)\{(\d+)\.\.(\d+)\}(.*)$/);
  if (!match) return [String(pattern)];

  const [, prefix, startText, endText, suffix] = match;
  const start = Number(startText);
  const end = Number(endText);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) {
    return [String(pattern)];
  }

  return Array.from({ length: end - start + 1 }, (_, index) => `${prefix}${start + index}${suffix}`);
}

function formatFillAnswer(item) {
  if (typeof item?.value === 'string' || typeof item?.value === 'number') {
    return String(item.value);
  }

  if (item?.valueFromFn) {
    const args = Array.isArray(item.args) ? item.args.join(', ') : '';
    return args ? `${item.valueFromFn}(${args})` : item.valueFromFn;
  }

  return '';
}

function buildGenerateAnswerFields(prompts = []) {
  return prompts
    .map((prompt, index) => ({ prompt, index }))
    .filter(({ prompt }) => prompt?.type === 'generateAnswer')
    .map(({ prompt, index }) => ({
      id: `prompt-${index + 1}`,
      label: `实验问题 ${index + 1}`,
      nodeName: `prompt.generateAnswer.${index + 1}`,
      value: '由 AI 根据 Prompt 生成，配置中未保存固定答案。',
      prompt: prompt.value || '',
    }));
}

export function buildExperimentPreviewConfig(profile = {}) {
  const uploadSourceGroups = normalizeUploadSourceGroups(profile.uploadExpImage?.source);
  const fillFields = Array.isArray(profile.fill)
    ? profile.fill.map((item, index) => ({
      id: item.id || `fill-${index + 1}`,
      label: item.id || `填空 ${index + 1}`,
      nodeName: item.id || `fill.${index + 1}`,
      value: formatFillAnswer(item),
      sourceArgs: Array.isArray(item.args) ? item.args : [],
      valueFromFn: item.valueFromFn || '',
    }))
    : [];

  const extractFields = Array.isArray(profile.extract)
    ? profile.extract.flatMap(expandNodePattern).map((nodeName) => ({
      id: nodeName,
      label: nodeName,
      nodeName,
      value: '',
    }))
    : [];

  return {
    fixedFields: fillFields,
    questions: buildGenerateAnswerFields(profile.prompts),
    extractFields,
    uploadSourceGroups,
    uploadSources: uploadSourceGroups.flat(),
  };
}
