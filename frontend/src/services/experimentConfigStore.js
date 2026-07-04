/**
 * Adapter helpers for experiment config returned by the backend.
 * The backend/database is the only source of truth for config_json.
 */
export function buildExperimentConfig(rawConfig) {
  const computedIds = new Set();
  const asyncIds = new Set();
  const fixedIds = new Set();
  const aiRecognizeIds = new Set();
  const imageUploadIds = new Set();
  const nodeMetaMap = {};

  const fields = rawConfig?.inputs?.fields || [];

  const ensureNodeMeta = (nodeId, patch = {}) => {
    if (!nodeId) return null;
    const current = nodeMetaMap[nodeId] || { nodeId };
    nodeMetaMap[nodeId] = { ...current, ...patch, nodeId };
    return nodeMetaMap[nodeId];
  };

  fields.forEach(f => {
    if (f.type === 'computed') computedIds.add(f.id);
    if (f.type === 'async') asyncIds.add(f.id);
    if (f.type === 'fixed') fixedIds.add(f.id);
    if (f.type === 'ai_recognize') aiRecognizeIds.add(f.id);
    if (f.type === 'image_upload') imageUploadIds.add(f.id);
    ensureNodeMeta(f.id, {
      type: f.type,
      fixedValue: f.type === 'fixed' && f.value !== undefined ? String(f.value) : undefined,
      imageSlotId: f.imageSlotId,
      fn: f.fn,
      source: 'inputs.fields',
    });
  });

  Object.entries(rawConfig?.formulas || {}).forEach(([nodeId, formula]) => {
    ensureNodeMeta(nodeId, {
      type: nodeMetaMap[nodeId]?.type || 'computed',
      formula,
      source: nodeMetaMap[nodeId]?.source || 'formulas',
    });
  });

  const collectSegments = (sections = [], source) => {
    sections.forEach((section) => {
      (section.segments || []).forEach((seg) => {
        if (seg && typeof seg === 'object' && seg.nodeId) {
          ensureNodeMeta(seg.nodeId, {
            source,
            sectionTitle: section.title,
          });
        }
      });
    });
  };

  collectSegments(rawConfig?.ui?.fixedSections || [], 'ui.fixedSections');
  collectSegments(rawConfig?.ui?.postDataSections || [], 'ui.postDataSections');

  const collectDataTable = (table, tableIndex) => {
    if (!table) return;
    const caption = table.caption || `实验数据表 ${tableIndex + 1}`;
    if (Array.isArray(table.rows)) {
      table.rows.forEach((row) => {
        (row.cells || []).forEach((cell) => {
          if (cell.nodeId) {
            ensureNodeMeta(cell.nodeId, {
              source: 'ui.dataTable',
              tableCaption: caption,
            });
          }
        });
      });
      return;
    }

    const rowCount = table.rowCount || 5;
    const columns = table.columns || [];
    for (let rowIdx = 1; rowIdx <= rowCount; rowIdx += 1) {
      columns.slice(1).forEach((col, colIdx) => {
        const pattern = col.nodePattern || table.nodePattern;
        if (!pattern) return;
        const nodeId = pattern
          .replaceAll('{r}', String(rowIdx))
          .replaceAll('{c}', String(colIdx));
        ensureNodeMeta(nodeId, {
          source: 'ui.dataTable',
          tableCaption: caption,
        });
      });
    }
  };

  (rawConfig?.ui?.dataTables || [rawConfig?.ui?.dataTable]).filter(Boolean).forEach(collectDataTable);

  (rawConfig?.ui?.questions || []).forEach((question, idx) => {
    if (!question.nodeId) return;
    ensureNodeMeta(question.nodeId, {
      type: nodeMetaMap[question.nodeId]?.type || 'generated',
      source: 'ui.questions',
      questionIndex: idx + 1,
    });
  });

  return {
    ...rawConfig,
    metaInfo: {
      computedIds,
      asyncIds,
      fixedIds,
      aiRecognizeIds,
      imageUploadIds,
      nodeMetaMap,
    },
  };
}

export function initFixedValues(fields = []) {
  const initial = {};
  for (const field of fields) {
    initial[field.id] = '';
  }
  return initial;
}
