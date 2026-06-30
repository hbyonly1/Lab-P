// V2 Experiment Configuration Store
// 静态引入所有的 V2/V3 实验配置 (vite 特有语法)
const configModules = import.meta.glob('../assets/configs/*.json', { eager: true });

// 将模块导出转换为可由 id 查询的 Map
// e.g., "../assets/configs/exp_meter_modification.json" -> { meta: { id: "exp_meter_modification" }, ... }配置集
export const v2Configs = Object.fromEntries(
  Object.values(configModules).map(mod => [mod.default.meta.id, mod.default])
);

/**
 * 获取实验配置（如果 ID 不匹配则返回 null 触发 403）
 */
export function getExperimentConfig(id) {
  const rawConfig = v2Configs[id];
  if (!rawConfig) return null;
  return buildExperimentConfig(rawConfig);
}

/**
 * 获取所有的实验列表（用于在 StudentExperimentsPage 展示）
 */
export function getAllExperiments() {
  return Object.values(v2Configs).map(config => ({
    id: config.meta.id,
    name: config.meta.name,
    status: config.meta.status || 'not_started',
    inputs: config.inputs
  }));
}

/**
 * 适配器：将原始 JSON 转换并附加有用的元数据（如字段分类），方便前端 UI 渲染时直接判断状态
 */
function buildExperimentConfig(rawConfig) {
  const computedIds = new Set();
  const asyncIds = new Set();
  const fixedIds = new Set();
  const extractIds = new Set();
  
  const fields = rawConfig.inputs?.fields || [];
  
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
      extractIds
    }
  };
}

/**
 * 提取固定字段的默认值
 */
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
