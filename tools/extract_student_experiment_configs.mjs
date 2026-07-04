import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'assets', 'complete_saves_student');
const BACKEND_CONFIG_DIR = path.join(ROOT, 'backend', 'configs');
const IMAGE_DIR = path.join(ROOT, 'frontend', 'public', 'assets', 'configs_images');

const TARGETS = [
  { name: '电表的改装', id: 'exp_meter_modification', sortOrder: 1 },
  { name: '落球法测粘滞系数', id: 'exp_falling_ball_viscosity', sortOrder: 2 },
  { name: '液晶电光效应实验0625', id: 'exp_liquid_crystal_0625', sortOrder: 3 },
  { name: '示波器的使用', id: 'exp_oscilloscope', sortOrder: 4 },
  { name: '空气比热容比的测定', id: 'exp_air_heat_capacity_ratio', sortOrder: 5 },
  { name: '三线摆和扭摆实验', id: 'exp_three_line_torsion_pendulum', sortOrder: 6 },
  { name: '钢丝杨氏模量的测定', id: 'exp_steel_wire_young_modulus', sortOrder: 7 },
  { name: '声速的测量', id: 'exp_sound_velocity', sortOrder: 8 },
  { name: '电位差计的原理和使用', id: 'exp_potentiometer', sortOrder: 9 },
  { name: '光电效应和普朗克常量的测定', id: 'exp_photoelectric_planck', sortOrder: 10 },
];

const args = process.argv.slice(2);
const allowManualExperiments = args.includes('--allow-manual');
const requested = new Set(args.filter((arg) => arg !== '--allow-manual'));
const targets = requested.size
  ? TARGETS.filter((target) => requested.has(target.id) || requested.has(target.name))
  : TARGETS.filter((target) => target.sortOrder > 4);

if (requested.size && targets.length === 0) {
  throw new Error(`No matching experiments for: ${Array.from(requested).join(', ')}`);
}

const protectedTargets = targets.filter((target) => target.sortOrder <= 4);
if (protectedTargets.length > 0 && !allowManualExperiments) {
  throw new Error(
    `Refusing to regenerate manually maintained experiments: ${protectedTargets
      .map((target) => target.id)
      .join(', ')}. Add --allow-manual only when you intentionally want to overwrite them.`
  );
}

fs.mkdirSync(BACKEND_CONFIG_DIR, { recursive: true });
fs.mkdirSync(IMAGE_DIR, { recursive: true });

const IGNORED_FIELD_IDS = new Set([
  'inpReportName',
  'importButtonXml',
  'importButton',
  'itemImagers',
  'fileNames',
]);

function decodeHtml(value = '') {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function formatNumberedText(value = '') {
  return value
    .replace(/\s+/g, ' ')
    .replace(/(计算处理)\s+(三线摆实验)/g, '$1\n$2')
    .replace(/([=。；;])\s*(扭摆实验\s+钢丝)/g, '$1\n$2')
    .replace(/[（(]\s*([1-9]\d*(?:\.\d+)?)\s*[）)]/g, '（$1）')
    .replace(/[（(]\s*([一二三四五六七八九十]+)\s*[）)]/g, '（$1）')
    .replace(/([^\n])\s*(?=(?:[1-9]\d*[、．.](?!\d)|[（(][1-9]\d*(?:\.\d+)?[）)]))/g, '$1\n')
    .replace(/([^\n])\s*(?=(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十]+[）)]|[A-D][.．、]))/g, '$1\n')
    .replace(/([A-D][.．、])(?=\S)/g, '$1 ')
    .replace(/([1-9]\d*[、．.](?!\d))(?=\S)/g, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripTags(value = '') {
  return formatNumberedText(decodeHtml(removeNoiseHtml(value).replace(/<[^>]*>/g, ' '))
    .replace(/[Σ]+/g, ' ')
    .replace(/请输入文本……/g, ' ')
    .trim());
}

function getAttr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtml(match?.[2] || match?.[3] || match?.[4] || '');
}

function getClassList(tag) {
  return getAttr(tag, 'class').split(/\s+/).filter(Boolean);
}

function classHas(tag, className) {
  return getClassList(tag).includes(className);
}

function classHasPrefix(tag, classPrefix) {
  return getClassList(tag).some((className) => className.startsWith(classPrefix));
}

function fieldWidthFromTag(tag) {
  const style = getAttr(tag, 'style');
  const width = style.match(/width\s*:\s*([^;]+)/i)?.[1];
  return width || '100px';
}

function fieldType(id, inputType, context = {}) {
  if (context.isImageUpload) return 'image_upload';
  if (id.endsWith('Area') || /DrawingArea|YSSJDrawing/.test(id)) return 'generated';
  if (/^(SYMD|SYYL)/.test(id)) return 'fixed';
  if (/^(SYBZ|OP|OP\d*)_Fill_/.test(id)) return 'fixed';
  if (/^(G|Y|S|K|D|L|N)\d+$/.test(id)) return 'computed';
  if (inputType === 'number') return 'ai_recognize';
  return 'ai_recognize';
}

function imageSlotIdForNode(nodeId) {
  return `IMG_${nodeId.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

function imageSlotIdForUploadNode(nodeId) {
  return nodeId === 'YSSJDrawingAreaArea' ? 'IMG_RAW_DATA' : imageSlotIdForNode(nodeId);
}

function saveImage(src, expId, counter) {
  if (!src || !src.startsWith('data:image/')) return src;
  const match = src.match(/^data:image\/([A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace('+xml', '');
  const filename = `${expId}_img_${String(counter).padStart(3, '0')}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(match[2], 'base64'));
  return `/assets/configs_images/${filename}`;
}

function findMatchingDivEnd(html, openStart) {
  return findMatchingTagEnd(html, 'div', openStart);
}

function findMatchingTagEnd(html, tagName, openStart) {
  const tagRe = new RegExp(`</?${tagName}\\b[^>]*>`, 'gi');
  tagRe.lastIndex = openStart;
  let depth = 0;
  let match;
  while ((match = tagRe.exec(html))) {
    if (match[0].startsWith('</')) {
      depth -= 1;
      if (depth === 0) return tagRe.lastIndex;
    } else if (!match[0].endsWith('/>')) {
      depth += 1;
    }
  }
  return html.length;
}

function innerHtmlOfDiv(divHtml) {
  const openEnd = divHtml.indexOf('>');
  const closeStart = divHtml.lastIndexOf('</div>');
  if (openEnd < 0 || closeStart < 0) return divHtml;
  return divHtml.slice(openEnd + 1, closeStart);
}

function findDivsWithClasses(html, classNames) {
  const divRe = /<div\b[^>]*>/gi;
  const blocks = [];
  let match;
  while ((match = divRe.exec(html))) {
    const tag = match[0];
    if (!classNames.every((className) => classHas(tag, className))) continue;
    const end = findMatchingDivEnd(html, match.index);
    blocks.push(html.slice(match.index, end));
    divRe.lastIndex = end;
  }
  return blocks;
}

function findFirstDivWithClass(html, className, fromIndex = 0) {
  const divRe = /<div\b[^>]*>/gi;
  divRe.lastIndex = fromIndex;
  let match;
  while ((match = divRe.exec(html))) {
    if (!classHas(match[0], className)) continue;
    const end = findMatchingDivEnd(html, match.index);
    return {
      start: match.index,
      end,
      html: html.slice(match.index, end),
      inner: innerHtmlOfDiv(html.slice(match.index, end)),
    };
  }
  return null;
}

function removeDivsWithClass(html, className) {
  let result = '';
  const divRe = /<div\b[^>]*>/gi;
  let cursor = 0;
  let match;
  while ((match = divRe.exec(html))) {
    if (!classHas(match[0], className)) continue;
    const end = findMatchingDivEnd(html, match.index);
    result += html.slice(cursor, match.index);
    cursor = end;
    divRe.lastIndex = end;
  }
  return result + html.slice(cursor);
}

function removeNoiseHtml(html = '') {
  let clean = html;
  for (const className of ['wysiwyg-toolbar', 'wysiwyg-editor']) {
    clean = removeDivsWithClass(clean, className);
  }
  clean = clean.replace(/<button\b[^>]*class=["'][^"']*btnRule[^"']*["'][\s\S]*?<\/button>/gi, '');
  clean = clean.replace(/<span\b[^>]*>\s*评分规则：\s*<\/span>/gi, '');
  return clean;
}

function pushText(segments, text) {
  const clean = stripTags(text);
  if (clean) segments.push(clean);
}

function pushField(fields, seen, id, patch = {}) {
  if (!id || IGNORED_FIELD_IDS.has(id)) return null;
  const existing = seen.get(id);
  if (existing) {
    Object.assign(existing, patch);
    return existing;
  }
  const field = { id, ...patch };
  fields.push(field);
  seen.set(id, field);
  return field;
}

function pushImageSlot(imageSlots, seenImageSlots, nodeId, title = '') {
  const id = imageSlotIdForUploadNode(nodeId);
  if (seenImageSlots.has(id)) {
    const current = imageSlots.find((slot) => slot.id === id);
    if (current) {
      current.title = current.title || title || nodeId;
      current.targetNodeId = current.targetNodeId || nodeId;
      if (id !== 'IMG_RAW_DATA') {
        current.purpose = current.purpose || 'answer_image';
        current.maxCount = current.maxCount || 1;
      }
    }
    return id;
  }
  seenImageSlots.add(id);
  const slot = {
    id,
    targetNodeId: nodeId,
    title: title || nodeId,
  };
  if (id !== 'IMG_RAW_DATA') {
    slot.purpose = 'answer_image';
    slot.maxCount = 1;
  }
  imageSlots.push(slot);
  return id;
}

function normalizeSegmentBreaks(segments) {
  return segments.map((seg, index) => {
    if (typeof seg !== 'string' || index === 0) return seg;
    if (!/^(?:[1-9]\d*[、．.](?!\d)|[一二三四五六七八九十]+、|[（(][1-9]\d*(?:\.\d+)?[）)]|[（(][一二三四五六七八九十]+[）)]|[A-D][.．、]|扭摆实验\s+钢丝|三线摆实验$)/.test(seg)) return seg;
    const previous = segments[index - 1];
    if (typeof previous === 'string' && previous.endsWith('\n')) return seg;
    return `\n${seg}`;
  });
}

function removeRawUploadMarkerText(segments) {
  const last = segments[segments.length - 1];
  if (typeof last !== 'string' || !last.includes('签字原始数据上传')) return;
  const clean = last
    .replace(/\s*签字原始数据上传\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean) {
    segments[segments.length - 1] = clean;
  } else {
    segments.pop();
  }
}

function cleanUploadTitle(value = '') {
  return formatNumberedText(value)
    .replace(/[；;]\s*$/g, '')
    .replace(/\s*：\s*/g, '：')
    .replace(/\s+/g, ' ')
    .replace(/照片\s+([1-9]\d*)/g, '照片$1')
    .trim();
}

function removeTrailingUploadTitleText(segments, title) {
  if (!title) return;
  const last = segments[segments.length - 1];
  if (typeof last !== 'string') return;

  const lines = formatNumberedText(last).split('\n');
  const normalizedTitle = cleanUploadTitle(title);
  const lastLine = cleanUploadTitle(lines[lines.length - 1] || '');
  if (lastLine !== normalizedTitle) return;

  const nextLines = lines.slice(0, -1);
  const nextText = nextLines.join('\n').trim();
  if (nextText) {
    segments[segments.length - 1] = nextText;
  } else {
    segments.pop();
  }
}

function parseInlineSegments(html, expId, imageCounter, fields, seenFields, imageSlots, seenImageSlots, context = {}) {
  const cleanHtml = removeNoiseHtml(html);
  const segments = [];
  const tokenRe = /<img\b[^>]*>|<input\b[^>]*>|<textarea\b[^>]*>(?:\s*<\/textarea>)?/gi;
  let last = 0;
  let match;

  while ((match = tokenRe.exec(cleanHtml))) {
    pushText(segments, cleanHtml.slice(last, match.index));
    const tag = match[0];
    const tagName = tag.match(/^<\s*(img|input|textarea)\b/i)?.[1].toLowerCase();

    if (tagName === 'img') {
      const src = saveImage(getAttr(tag, 'src'), expId, imageCounter.count++);
      if (src) {
        const width = getAttr(tag, 'width');
        const height = getAttr(tag, 'height');
        const numericHeight = Number.parseFloat(height);
        const numericWidth = Number.parseFloat(width);
        const imageSeg = {
          type: 'image',
          src,
          inline: (numericHeight > 0 && numericHeight < 60) || (numericWidth > 0 && numericWidth < 180),
        };
        if (width) imageSeg.width = `${Number.parseFloat(width) || width}px`;
        if (height) imageSeg.height = `${Number.parseFloat(height) || height}px`;
        segments.push(imageSeg);
      }
    } else {
      const id = getAttr(tag, 'id');
      if (id && !IGNORED_FIELD_IDS.has(id)) {
        const inputType = getAttr(tag, 'type') || (tagName === 'textarea' ? 'textarea' : 'text');
        const isArea = tagName === 'textarea' && (id.endsWith('Area') || /DrawingArea|YSSJDrawing/.test(id));
        const isImageUpload = Boolean(context.isDataProcessing && isArea);
        const type = fieldType(id, inputType, { isImageUpload });
        const patch = { type };

        if (isImageUpload) {
          const title = inferImageUploadTitle(segments, id);
          patch.imageSlotId = pushImageSlot(imageSlots, seenImageSlots, id, title);
          if (id !== 'YSSJDrawingAreaArea') {
            removeTrailingUploadTitleText(segments, title);
            segments.push({
              nodeId: id,
              title,
              emptyTitle: '拖动文件到这里上传图片',
              emptyHint: '支持多图片，可拖动上传或点击选择',
            });
          } else {
            removeRawUploadMarkerText(segments);
          }
        } else {
          segments.push({ nodeId: id, width: fieldWidthFromTag(tag) });
        }

        pushField(fields, seenFields, id, patch);
      }
    }
    last = tokenRe.lastIndex;
  }

  pushText(segments, cleanHtml.slice(last));
  return normalizeSegmentBreaks(segments);
}

function inferImageUploadTitle(segments, nodeId) {
  const previousText = [...segments].reverse().find((seg) => typeof seg === 'string') || '';
  if (!previousText.trim()) return nodeId === 'YSSJDrawingAreaArea' ? '签字原始数据上传' : nodeId;
  const lines = formatNumberedText(previousText)
    .split('\n')
    .map((line) => cleanUploadTitle(line.replace(/^[°；;\s]+/, '')))
    .filter(Boolean);
  const uploadLine = [...lines]
    .reverse()
    .find((line) => /照片|上传/.test(line) && /[（(][1-9]\d*(?:\.\d+)?[）)]/.test(line));
  if (uploadLine) return uploadLine;
  const numberedLine = [...lines]
    .reverse()
    .find((line) => /(?:^[1-9]\d*[、．.]|^[（(][1-9]\d*(?:\.\d+)?[）)])/.test(line));
  return numberedLine || lines[lines.length - 1] || nodeId;
}

function extractContent(html) {
  const startMatch = html.match(/<div\b[^>]*id=["']content["'][^>]*>/i);
  if (!startMatch) return html;
  const start = startMatch.index;
  return html.slice(start, findMatchingDivEnd(html, start));
}

function splitPanels(content) {
  return findDivsWithClasses(content, ['panel', 'panel-default']).map((panelHtml) => {
    const heading = findFirstDivWithClass(panelHtml, 'panel-heading');
    const title = stripTags(heading?.inner || '');
    const body = findFirstDivWithClass(panelHtml, 'panel-body', heading?.end || 0);
    return { title, html: body?.inner || '' };
  }).filter((panel) => panel.title);
}

function parseTable(tableHtml) {
  const caption = stripTags(tableHtml.slice(0, tableHtml.indexOf('<table')));
  const id = getAttr(tableHtml.match(/<table\b[^>]*>/i)?.[0] || '', 'id');
  const rows = [];
  const rowMatches = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of rowMatches) {
    const rowHtml = rowMatch[1];
    const cells = [];
    const cellMatches = [...rowHtml.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)];
    for (const cellMatch of cellMatches) {
      const attrs = cellMatch[1];
      const cellHtml = cellMatch[2];
      const input = cellHtml.match(/<input\b[^>]*>/i);
      const cell = {};
      const colSpan = getAttr(`<td ${attrs}>`, 'colspan');
      if (colSpan) cell.colSpan = Number(colSpan);
      if (input) {
        cell.nodeId = getAttr(input[0], 'id');
        const text = stripTags(cellHtml.replace(input[0], ''));
        if (text) cell.text = text;
      } else {
        const text = stripTags(cellHtml);
        if (text) cell.text = text;
      }
      cells.push(cell);
    }
    if (cells.length) rows.push({ isHeader: rows.length === 0, cells });
  }
  return { caption: caption || id || '实验数据表', rows };
}

function findTableBlocks(html) {
  const blocks = [];
  const divRe = /<div\b[^>]*>/gi;
  const tableRe = /<table\b[^>]*>/gi;
  let match;

  while ((match = divRe.exec(html))) {
    if (!classHasPrefix(match[0], 'divtab')) continue;
    const end = findMatchingDivEnd(html, match.index);
    const blockHtml = html.slice(match.index, end);
    if (/<table\b/i.test(blockHtml)) {
      blocks.push({ start: match.index, end, html: blockHtml });
    }
    divRe.lastIndex = end;
  }

  while ((match = tableRe.exec(html))) {
    const isInsideKnownBlock = blocks.some((block) => match.index >= block.start && match.index < block.end);
    if (isInsideKnownBlock) continue;
    const end = findMatchingTagEnd(html, 'table', match.index);
    blocks.push({ start: match.index, end, html: html.slice(match.index, end) });
    tableRe.lastIndex = end;
  }

  return blocks.sort((a, b) => a.start - b.start);
}

function splitChunksByTables(html) {
  const chunks = [];
  let cursor = 0;
  const tableBlocks = findTableBlocks(html);

  if (!tableBlocks.length) {
    return html.trim() ? [{ type: 'text', html }] : [];
  }

  for (const tableBlock of tableBlocks) {
    if (tableBlock.start < cursor) continue;
    const before = html.slice(cursor, tableBlock.start);
    if (before.trim()) chunks.push({ type: 'text', html: before });
    chunks.push({ type: 'table', html: tableBlock.html });
    cursor = tableBlock.end;
  }

  const rest = html.slice(cursor);
  if (rest.trim()) chunks.push({ type: 'text', html: rest });
  return chunks;
}

function collectQuestionTitle(segments, areaSegment) {
  const index = segments.indexOf(areaSegment);
  return segments
    .slice(0, index)
    .filter((seg) => typeof seg === 'string')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseExperiment(target) {
  const { name, id: expId, sortOrder } = target;
  const sourcePath = path.join(SOURCE_DIR, `${name}.html`);
  const html = fs.readFileSync(sourcePath, 'utf8');
  const content = extractContent(html);
  const panels = splitPanels(content);
  const fields = [];
  const seenFields = new Map();
  const imageSlots = [{ id: 'IMG_RAW_DATA' }];
  const seenImageSlots = new Set(['IMG_RAW_DATA']);
  const imageCounter = { count: 1 };
  const fixedSections = [];
  const postDataSections = [];
  const dataTables = [];
  const questions = [];

  const pushSection = (targetSections, title, segments) => {
    if (!segments.length) return;
    const existing = targetSections.find((section) => section.title === title);
    if (existing) {
      existing.segments.push(...segments);
    } else {
      targetSections.push({ title, segments });
    }
  };

  for (const panel of panels) {
    const isQuestionPanel = /分析|拓展|思考|问题/.test(panel.title);
    const isDataProcessing = /数据处理|实验内容|实验数据|处理/.test(panel.title);
    const chunks = splitChunksByTables(panel.html);
    const panelSegments = [];

    for (const chunk of chunks) {
      if (chunk.type === 'table') {
        const table = parseTable(chunk.html);
        for (const row of table.rows) {
          for (const cell of row.cells) {
            if (cell.nodeId) pushField(fields, seenFields, cell.nodeId, { type: 'ai_recognize' });
          }
        }
        dataTables.push(table);
        continue;
      }

      const segments = parseInlineSegments(
        chunk.html,
        expId,
        imageCounter,
        fields,
        seenFields,
        imageSlots,
        seenImageSlots,
        { isDataProcessing }
      );
      if (!segments.length) continue;

      const textareaSegments = segments.filter((seg) => {
        const field = seenFields.get(seg.nodeId);
        return field?.type === 'generated';
      });

      if (isQuestionPanel && textareaSegments.length > 0) {
        for (const area of textareaSegments) {
          questions.push({
            nodeId: area.nodeId,
            title: collectQuestionTitle(segments, area) || `实验问题 ${questions.length + 1}`,
            rows: 5,
          });
        }
      }
      panelSegments.push(...segments);
    }

    if (isDataProcessing || isQuestionPanel) {
      pushSection(postDataSections, panel.title, panelSegments);
    } else {
      pushSection(fixedSections, panel.title, panelSegments);
    }
  }

  return {
    meta: {
      id: expId,
      name,
      version: '2.0',
      sortOrder,
      enabled: true,
    },
    inputs: {
      images: imageSlots,
      fields,
    },
    ui: {
      fixedSections,
      dataTables,
      postDataSections,
      questions,
    },
    ai: {
      recognition: {
        imageRef: 'IMG_RAW_DATA',
      },
    },
    formulas: {},
  };
}

function readExistingConfig(expId) {
  const configPath = path.join(BACKEND_CONFIG_DIR, `${expId}.json`);
  if (!fs.existsSync(configPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}

function mergeExistingConfig(config, existing) {
  if (!existing) return config;

  if (existing.formulas && Object.keys(existing.formulas).length > 0) {
    config.formulas = existing.formulas;
  }

  const existingFields = new Map(
    (existing.inputs?.fields || []).map((field) => [field.id, field])
  );

  for (const field of config.inputs.fields) {
    const oldField = existingFields.get(field.id);
    if (!oldField) continue;
    if (field.type === 'fixed' && Object.prototype.hasOwnProperty.call(oldField, 'value')) {
      field.value = oldField.value;
    }
  }

  if (typeof existing.meta?.enabled === 'boolean') {
    config.meta.enabled = existing.meta.enabled;
  }

  return config;
}

for (const target of targets) {
  const config = mergeExistingConfig(parseExperiment(target), readExistingConfig(target.id));
  const json = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(path.join(BACKEND_CONFIG_DIR, `${target.id}.json`), json);
  console.log(`${target.id}: fields=${config.inputs.fields.length}, tables=${config.ui.dataTables.length}, questions=${config.ui.questions.length}`);
}
