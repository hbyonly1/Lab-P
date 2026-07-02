import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SOURCE_DIR = path.join(ROOT, 'assets', 'complete_saves_student');
const BACKEND_CONFIG_DIR = path.join(ROOT, 'backend', 'configs');
const IMAGE_DIR = path.join(ROOT, 'frontend', 'public', 'assets', 'configs_images');

const TARGETS = [
  ['三线摆和扭摆实验', 'exp_three_line_torsion_pendulum'],
  ['光电效应和普朗克常量的测定', 'exp_photoelectric_planck'],
  ['声速的测量', 'exp_sound_velocity'],
  ['液晶电光效应实验0625', 'exp_liquid_crystal_0625'],
  ['电位差计的原理和使用', 'exp_potentiometer'],
  ['示波器的使用', 'exp_oscilloscope'],
  ['空气比热容比的测定', 'exp_air_heat_capacity_ratio'],
  ['落球法测粘滞系数', 'exp_falling_ball_viscosity'],
];

fs.mkdirSync(BACKEND_CONFIG_DIR, { recursive: true });
fs.mkdirSync(IMAGE_DIR, { recursive: true });

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function stripTags(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

function getAttr(tag, name) {
  const match = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeHtml(match?.[2] || match?.[3] || match?.[4] || '');
}

function fieldWidthFromTag(tag) {
  const style = getAttr(tag, 'style');
  const width = style.match(/width\s*:\s*([^;]+)/i)?.[1];
  return width || '100px';
}

function fieldType(id, inputType) {
  if (id.endsWith('Area') || /DrawingArea|YSSJDrawing/.test(id)) return 'generated';
  if (/^(SYMD|SYYL|SYBZ|OP|OP\d*)_Fill_/.test(id)) return 'extract';
  if (/^(G|Y|S|K|D|L|N)\d+$/.test(id)) return 'computed';
  if (inputType === 'number') return 'extract';
  return 'extract';
}

function saveImage(src, expId, counter) {
  if (!src.startsWith('data:image/')) return src;
  const match = src.match(/^data:image\/([A-Za-z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === 'jpeg' ? 'jpg' : match[1].replace('+xml', '');
  const filename = `${expId}_img_${String(counter).padStart(3, '0')}.${ext}`;
  fs.writeFileSync(path.join(IMAGE_DIR, filename), Buffer.from(match[2], 'base64'));
  return `/assets/configs_images/${filename}`;
}

function pushText(segments, text) {
  const clean = stripTags(text);
  if (clean) segments.push(clean);
}

function pushField(fields, seen, id, type, label = '') {
  if (!id || seen.has(id)) return;
  seen.add(id);
  fields.push({ id, type, label: label || id });
}

function parseInlineSegments(html, expId, imageCounter, fields, seenFields) {
  const segments = [];
  const tokenRe = /<(img|input|textarea)\b[^>]*>(?:[\s\S]*?<\/textarea>)?/gi;
  let last = 0;
  let match;
  while ((match = tokenRe.exec(html))) {
    pushText(segments, html.slice(last, match.index));
    const tag = match[0];
    const tagName = match[1].toLowerCase();

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
      if (id && !['inpReportName', 'importButtonXml', 'importButton', 'itemImagers', 'fileNames'].includes(id)) {
        const inputType = getAttr(tag, 'type') || (tagName === 'textarea' ? 'textarea' : 'text');
        const type = fieldType(id, inputType);
        pushField(fields, seenFields, id, type);
        segments.push({ nodeId: id, width: fieldWidthFromTag(tag) });
      }
    }
    last = tokenRe.lastIndex;
  }
  pushText(segments, html.slice(last));
  return segments;
}

function extractContent(html) {
  const contentMatch = html.match(/<div id="content">([\s\S]*?)<\/div>\s*<\/td>/i);
  return contentMatch?.[1] || html;
}

function splitPanels(content) {
  const headingRe = /<div class="panel-heading row">[\s\S]*?<span class="col-md-[^"]* text-left">([\s\S]*?)<\/span>[\s\S]*?<div class="panel-body">([\s\S]*?)(?=<div class="panel panel-default">|<\/div>\s*<\/div>\s*<\/div>\s*<\/td>|$)/gi;
  const panels = [];
  let match;
  while ((match = headingRe.exec(content))) {
    panels.push({ title: stripTags(match[1]), html: match[2] });
  }
  return panels;
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
        cell.label = stripTags(cellHtml.replace(input[0], ''));
      } else {
        cell.label = stripTags(cellHtml);
      }
      cells.push(cell);
    }
    if (cells.length) {
      rows.push({ isHeader: rows.length === 0, cells });
    }
  }
  return { caption: caption || id || '实验数据表', rows };
}

function parseExperiment(name, expId) {
  const sourcePath = path.join(SOURCE_DIR, `${name}.html`);
  const html = fs.readFileSync(sourcePath, 'utf8');
  const content = extractContent(html);
  const panels = splitPanels(content);
  const fields = [];
  const seenFields = new Set();
  const imageCounter = { count: 1 };
  const fixedSections = [];
  const postDataSections = [];
  const dataTables = [];
  const questions = [];

  for (const panel of panels) {
    const isQuestionPanel = /分析|拓展|思考|问题/.test(panel.title);
    const chunks = [];
    let cursor = 0;
    const tableRe = /<div class="divtab[^"]*"[\s\S]*?<\/table>[\s\S]*?<\/div>/gi;
    let tableMatch;
    while ((tableMatch = tableRe.exec(panel.html))) {
      const before = panel.html.slice(cursor, tableMatch.index);
      if (before.trim()) chunks.push({ type: 'text', html: before });
      chunks.push({ type: 'table', html: tableMatch[0] });
      cursor = tableRe.lastIndex;
    }
    const rest = panel.html.slice(cursor);
    if (rest.trim()) chunks.push({ type: 'text', html: rest });

    for (const chunk of chunks) {
      if (chunk.type === 'table') {
        const table = parseTable(chunk.html);
        for (const row of table.rows) {
          for (const cell of row.cells) {
            if (cell.nodeId) pushField(fields, seenFields, cell.nodeId, 'extract', cell.label);
          }
        }
        dataTables.push(table);
        continue;
      }

      const segments = parseInlineSegments(chunk.html, expId, imageCounter, fields, seenFields);
      if (!segments.length) continue;

      const textareaSegments = segments.filter((seg) => typeof seg !== 'string' && seg.nodeId && seg.nodeId.endsWith('Area'));
      if (isQuestionPanel && textareaSegments.length > 0) {
        for (const area of textareaSegments) {
          const textBefore = segments
            .slice(0, segments.indexOf(area))
            .filter((seg) => typeof seg === 'string')
            .join(' ')
            .trim();
          questions.push({
            nodeId: area.nodeId,
            title: textBefore || `实验问题 ${questions.length + 1}`,
            rows: 5,
          });
        }
      }

      const section = { title: panel.title, segments };
      if (/数据处理|实验内容|实验数据|处理/.test(panel.title)) {
        postDataSections.push(section);
      } else if (!isQuestionPanel) {
        fixedSections.push(section);
      } else {
        postDataSections.push(section);
      }
    }
  }

  if (!questions.length) {
    for (const field of fields.filter((f) => f.id.endsWith('Area'))) {
      questions.push({ nodeId: field.id, title: `实验问题 ${questions.length + 1}`, rows: 5 });
    }
  }

  return {
    meta: {
      id: expId,
      name,
      version: '2.0',
      status: 'not_started',
    },
    inputs: {
      images: [{ id: 'IMG_RAW_DATA', label: '原始实验记录与曲线图片' }],
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
        prompt: `提取${name}实验报告中的表格数据、填空和曲线读数`,
      },
      answerGeneration: {
        prompt: `基于${name}实验原理，用中文学术性语言回答实验分析与拓展题。`,
      },
    },
    formulas: {},
  };
}

for (const [name, expId] of TARGETS) {
  const config = parseExperiment(name, expId);
  const json = `${JSON.stringify(config, null, 2)}\n`;
  fs.writeFileSync(path.join(BACKEND_CONFIG_DIR, `${expId}.json`), json);
  console.log(`${expId}: fields=${config.inputs.fields.length}, tables=${config.ui.dataTables.length}, questions=${config.ui.questions.length}`);
}
