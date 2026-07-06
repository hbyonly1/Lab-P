#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const configDir = path.join(root, 'backend', 'configs');
const args = new Set(process.argv.slice(2));
const write = args.has('--write');
const check = args.has('--check') || !write;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item || seen.has(item)) return false;
    seen.add(item);
    return true;
  });
}

function questionNodeIds(config) {
  return uniqueItems((config.ui?.questions || []).map((item) => item?.nodeId).filter(Boolean));
}

function targetTypeFor(fieldId, fieldById, questionIds) {
  const field = fieldById.get(fieldId);
  if (field?.type === 'image_upload') return 'wysiwyg_image';
  if (questionIds.has(fieldId)) return 'wysiwyg_text';
  return null;
}

function mappingFor(fieldId, fieldById, questionIds) {
  const item = {
    sourceId: fieldId,
    targetLocator: `#${fieldId}`,
  };
  const targetType = targetTypeFor(fieldId, fieldById, questionIds);
  if (targetType) item.targetType = targetType;
  return item;
}

function normalizeMapping(mapping, fieldById, questionIds) {
  const next = { ...mapping };
  if (!next.targetLocator && next.sourceId) {
    next.targetLocator = `#${next.sourceId}`;
  }
  const expectedTargetType = targetTypeFor(next.sourceId, fieldById, questionIds);
  if (expectedTargetType) {
    next.targetType = expectedTargetType;
  } else if (next.targetType === 'text') {
    delete next.targetType;
  }
  return next;
}

function completeConfig(config) {
  const fields = config.inputs?.fields || [];
  const fieldIds = uniqueItems(fields.map((item) => item?.id).filter(Boolean));
  const fieldById = new Map(fields.filter((item) => item?.id).map((item) => [item.id, item]));
  const questions = questionNodeIds(config);
  const questionSet = new Set(questions);
  const requiredIds = uniqueItems([...fieldIds, ...questions]);
  const automation = { ...(config.automation || {}) };
  const existingMappings = Array.isArray(automation.mappings) ? automation.mappings : [];
  const seen = new Set();
  const mappings = [];
  const warnings = [];

  for (const image of config.inputs?.images || []) {
    if (image?.targetNodeId && !fieldById.has(image.targetNodeId)) {
      warnings.push(`image slot ${image.id || '(unknown)'} targetNodeId=${image.targetNodeId} has no matching inputs.fields item`);
    }
  }

  for (const mapping of existingMappings) {
    if (!mapping?.sourceId) continue;
    if (seen.has(mapping.sourceId)) {
      warnings.push(`duplicate mapping sourceId=${mapping.sourceId} removed`);
      continue;
    }
    seen.add(mapping.sourceId);
    mappings.push(normalizeMapping(mapping, fieldById, questionSet));
  }

  for (const fieldId of requiredIds) {
    if (seen.has(fieldId)) continue;
    seen.add(fieldId);
    mappings.push(mappingFor(fieldId, fieldById, questionSet));
  }

  automation.mappings = mappings;
  if (!automation.submitLocator) {
    automation.submitLocator = 'a:has-text("提交")';
  }

  return {
    config: {
      ...config,
      automation,
    },
    warnings,
  };
}

function stableStringify(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const files = fs.readdirSync(configDir).filter((file) => file.endsWith('.json')).sort();
const changed = [];
const allWarnings = [];

for (const file of files) {
  const filePath = path.join(configDir, file);
  const before = fs.readFileSync(filePath, 'utf8');
  const config = readJson(filePath);
  const { config: nextConfig, warnings } = completeConfig(config);
  const after = stableStringify(nextConfig);
  if (warnings.length > 0) {
    allWarnings.push({ file, warnings });
  }
  if (before !== after) {
    changed.push(file);
    if (write) {
      fs.writeFileSync(filePath, after, 'utf8');
    }
  }
}

if (allWarnings.length > 0) {
  for (const item of allWarnings) {
    console.warn(`${item.file}:`);
    for (const warning of item.warnings) console.warn(`  - ${warning}`);
  }
}

if (check && changed.length > 0) {
  console.error(`automation mappings need updates: ${changed.join(', ')}`);
  process.exit(1);
}

console.log(write ? `updated ${changed.length} config file(s)` : 'automation mappings are complete');
if (changed.length > 0) console.log(changed.join('\n'));
