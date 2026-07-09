const DEFAULT_PLOT_WIDTH = 1400;
const DEFAULT_PLOT_HEIGHT = 960;
const DEFAULT_MARGIN = { top: 110, right: 70, bottom: 115, left: 120 };
const DEFAULT_EXCEL_CHART_WIDTH = 1642;
const DEFAULT_EXCEL_CHART_HEIGHT = 1188;
const DEFAULT_EXCEL_MARGIN = { top: 70, right: 25, bottom: 125, left: 148 };

const numberFromValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
};

const valuesForNodes = (values, nodes = []) => (
  (nodes || []).map(nodeId => numberFromValue(values?.[nodeId]))
);

const valuesForSource = (source = {}, values) => {
  if (Array.isArray(source.values)) return source.values.map(numberFromValue);
  return valuesForNodes(values, source.nodes || []);
};

const finitePairs = (xValues, yValues) => {
  const pairs = [];
  xValues.forEach((x, index) => {
    const y = yValues[index];
    if (Number.isFinite(x) && Number.isFinite(y)) pairs.push({ x, y });
  });
  return pairs;
};

const padRange = (min, max) => {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  if (min === max) return [min - 1, max + 1];
  const padding = (max - min) * 0.08;
  return [min - padding, max + padding];
};

const niceTicks = (min, max, targetCount = 6) => {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [];
  const rawStep = Math.abs(max - min) / Math.max(Number(targetCount) - 1, 1);
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;
  let step = magnitude;
  if (residual >= 5) step = 5 * magnitude;
  else if (residual >= 2) step = 2 * magnitude;
  const start = Math.ceil(min / step) * step;
  const end = Math.floor(max / step) * step;
  const ticks = [];
  for (let value = start; value <= end + step * 0.5; value += step) {
    ticks.push(Number(value.toPrecision(12)));
  }
  return ticks;
};

const bindingValue = (binding, values) => {
  if (binding && typeof binding === 'object' && binding.nodeId) {
    return values?.[binding.nodeId];
  }
  return binding;
};

const formatNumberLabel = (value, fallbackDigits = 4) => {
  const raw = value === null || value === undefined ? '' : String(value).trim();
  const numeric = numberFromValue(raw);
  if (!Number.isFinite(numeric)) return raw;
  if (raw && raw.length <= 10 && !/[eE]/.test(raw)) return raw;
  return Number(numeric.toPrecision(fallbackDigits)).toString();
};

const formatPointValueLabel = (value, options = {}) => {
  const numeric = numberFromValue(value);
  if (!Number.isFinite(numeric)) return '';
  if (Number.isInteger(options.decimals)) return numeric.toFixed(options.decimals);
  return formatNumberLabel(numeric, Number(options.digits || 4));
};

const formatAxisTickLabel = (value, axis = {}) => {
  const numeric = numberFromValue(value);
  if (Number.isFinite(numeric) && Number.isInteger(axis.tickDecimals)) {
    return numeric.toFixed(axis.tickDecimals);
  }
  return formatNumberLabel(value);
};

const applyLabelTemplate = (template, params) => {
  if (!template) return '';
  const slope = params.slopeRaw;
  const intercept = params.interceptRaw;
  const interceptNumeric = numberFromValue(intercept);
  const interceptAbs = Number.isFinite(interceptNumeric)
    ? formatNumberLabel(Math.abs(interceptNumeric))
    : formatNumberLabel(intercept);
  const interceptSigned = Number.isFinite(interceptNumeric)
    ? `${interceptNumeric < 0 ? '- ' : '+ '}${interceptAbs}`
    : formatNumberLabel(intercept);
  return template
    .replaceAll('{slope}', formatNumberLabel(slope))
    .replaceAll('{intercept}', formatNumberLabel(intercept))
    .replaceAll('{interceptSigned}', interceptSigned);
};

const canvasToFile = (canvas, fileName) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (!blob) {
      reject(new Error('曲线图生成失败'));
      return;
    }
    resolve(new File([blob], fileName || 'computed-plot.png', { type: 'image/png' }));
  }, 'image/png', 0.96);
});

const drawDataPath = (ctx, pairs, toX, toY, smooth = false, tension = 0.18) => {
  if (!pairs.length) return;
  ctx.beginPath();
  pairs.forEach((point, index) => {
    const x = toX(point.x);
    const y = toY(point.y);
    if (index === 0) {
      ctx.moveTo(x, y);
      return;
    }
    if (!smooth || pairs.length < 3) {
      ctx.lineTo(x, y);
      return;
    }

    const previous = pairs[index - 1];
    const beforePrevious = pairs[index - 2] || previous;
    const next = pairs[index + 1] || point;
    const cp1x = toX(previous.x) + (toX(point.x) - toX(beforePrevious.x)) * tension;
    const cp1y = toY(previous.y) + (toY(point.y) - toY(beforePrevious.y)) * tension;
    const cp2x = x - (toX(next.x) - toX(previous.x)) * tension;
    const cp2y = y - (toY(next.y) - toY(previous.y)) * tension;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y);
  });
};

const drawPlot = async (asset, values) => {
  const plot = asset.plot || {};
  const output = asset.output || {};
  const width = Number(output.width || plot.width || DEFAULT_PLOT_WIDTH);
  const height = Number(output.height || plot.height || DEFAULT_PLOT_HEIGHT);
  const margin = { ...DEFAULT_MARGIN, ...(plot.margin || {}) };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持生成曲线图');

  const axisPairs = finitePairs(valuesForSource(plot.xAxis, values), valuesForSource(plot.yAxis, values));
  if (axisPairs.length < 2) throw new Error('曲线图数据不足，至少需要两组有效点');

  let xMin = Math.min(...axisPairs.map(point => point.x));
  let xMax = Math.max(...axisPairs.map(point => point.x));
  let yMin = Math.min(...axisPairs.map(point => point.y));
  let yMax = Math.max(...axisPairs.map(point => point.y));

  (plot.layers || []).forEach((layer) => {
    if (layer.type !== 'line' || layer.model?.type !== 'linear') return;
    const slope = numberFromValue(bindingValue(layer.model.parameters?.slope, values));
    const intercept = numberFromValue(bindingValue(layer.model.parameters?.intercept, values));
    if (!Number.isFinite(slope) || !Number.isFinite(intercept)) return;
    const yA = slope * xMin + intercept;
    const yB = slope * xMax + intercept;
    yMin = Math.min(yMin, yA, yB);
    yMax = Math.max(yMax, yA, yB);
  });

  [xMin, xMax] = plot.xAxis?.range || padRange(xMin, xMax);
  [yMin, yMax] = plot.yAxis?.range || padRange(yMin, yMax);

  const plotLeft = margin.left;
  const plotTop = margin.top;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const toX = (x) => plotLeft + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const toY = (y) => plotTop + plotHeight - ((y - yMin) / (yMax - yMin)) * plotHeight;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  const style = plot.style || {};
  const titleFont = style.titleFont || '42px Arial, "Microsoft YaHei", sans-serif';
  const tickFont = style.tickFont || '26px Arial, "Microsoft YaHei", sans-serif';
  const axisLabelFont = style.axisLabelFont || '32px Arial, "Microsoft YaHei", sans-serif';

  ctx.font = titleFont;
  ctx.fillStyle = style.textColor || '#111827';
  ctx.textAlign = 'center';
  ctx.fillText(plot.title || '拟合曲线', width / 2, Number(style.titleY || 64));

  ctx.strokeStyle = style.gridColor || '#e5e7eb';
  ctx.lineWidth = Number(style.gridLineWidth || 2);
  ctx.setLineDash(style.gridDash || []);
  ctx.fillStyle = style.textColor || '#111827';
  ctx.font = tickFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const defaultTickCount = 6;
  const xTicks = Array.isArray(plot.xAxis?.ticks)
    ? plot.xAxis.ticks
    : niceTicks(xMin, xMax, plot.xAxis?.tickCount || defaultTickCount);
  const yTicks = Array.isArray(plot.yAxis?.ticks)
    ? plot.yAxis.ticks
    : niceTicks(yMin, yMax, plot.yAxis?.tickCount || defaultTickCount);
  xTicks.forEach((tick) => {
    const xValue = Number(tick);
    if (!Number.isFinite(xValue) || xValue < xMin || xValue > xMax) return;
    const x = toX(xValue);
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + plotHeight);
    ctx.stroke();
    ctx.fillText(formatAxisTickLabel(tick, plot.xAxis), x, plotTop + plotHeight + Number(style.xTickOffsetY || 34));
  });

  yTicks.forEach((tick) => {
    const yValue = Number(tick);
    if (!Number.isFinite(yValue) || yValue < yMin || yValue > yMax) return;
    const y = toY(yValue);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(formatAxisTickLabel(tick, plot.yAxis), plotLeft - Number(style.yTickOffsetX || 20), y);
    ctx.textAlign = 'center';
  });
  ctx.setLineDash([]);

  ctx.strokeStyle = style.borderColor || '#111827';
  ctx.lineWidth = Number(style.borderWidth || 4);
  ctx.strokeRect(plotLeft, plotTop, plotWidth, plotHeight);

  ctx.font = axisLabelFont;
  ctx.fillText(plot.xAxis?.label || '', plotLeft + plotWidth / 2, height - 34);
  ctx.save();
  ctx.translate(46, plotTop + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(plot.yAxis?.label || '', 0, 0);
  ctx.restore();

  const legendItems = [];
  (plot.layers || []).forEach((layer) => {
    if (layer.type === 'scatter') {
      const layerPairs = finitePairs(
        valuesForSource({ values: layer.xValues, nodes: layer.xNodes || plot.xAxis?.nodes }, values),
        valuesForSource({ values: layer.yValues, nodes: layer.yNodes || plot.yAxis?.nodes }, values),
      );
      const color = layer.style?.color || '#e3332a';
      ctx.fillStyle = color;
      layerPairs.forEach((point) => {
        ctx.beginPath();
        ctx.arc(toX(point.x), toY(point.y), Number(layer.style?.radius || 11), 0, Math.PI * 2);
        ctx.fill();
      });
      const valueLabels = layer.valueLabels || {};
      if (valueLabels.enabled) {
        ctx.font = valueLabels.font || '26px Arial, "Microsoft YaHei", sans-serif';
        ctx.fillStyle = valueLabels.color || '#111827';
        ctx.textAlign = valueLabels.align || 'center';
        ctx.textBaseline = 'middle';
        layerPairs.forEach((point) => {
          const labelValue = valueLabels.source === 'x' ? point.x : point.y;
          const label = formatPointValueLabel(labelValue, valueLabels);
          if (!label) return;
          ctx.fillText(label, toX(point.x) + Number(valueLabels.offsetX || 0), toY(point.y) + Number(valueLabels.offsetY || -28));
        });
      }
      if (layer.label && layer.showInLegend !== false) legendItems.push({ type: 'point', color, label: layer.label });
      return;
    }

    if (layer.type === 'polyline') {
      const layerPairs = finitePairs(
        valuesForSource({ values: layer.xValues, nodes: layer.xNodes || plot.xAxis?.nodes }, values),
        valuesForSource({ values: layer.yValues, nodes: layer.yNodes || plot.yAxis?.nodes }, values),
      );
      if (layerPairs.length < 2) return;
      const color = layer.style?.color || '#1d4ed8';
      const lineWidth = Number(layer.style?.lineWidth || 6);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      drawDataPath(ctx, layerPairs, toX, toY, layer.style?.curve === 'smooth', Number(layer.style?.tension || 0.18));
      ctx.stroke();
      if (layer.label && layer.showInLegend !== false) legendItems.push({ type: 'line', color, label: layer.label, lineWidth });
      return;
    }

    if (layer.type === 'line' && layer.model?.type === 'linear') {
      const slopeRaw = bindingValue(layer.model.parameters?.slope, values);
      const interceptRaw = bindingValue(layer.model.parameters?.intercept, values);
      const slope = numberFromValue(slopeRaw);
      const intercept = numberFromValue(interceptRaw);
      if (!Number.isFinite(slope) || !Number.isFinite(intercept)) {
        throw new Error('曲线图缺少有效的线性拟合参数');
      }
      const color = layer.style?.color || '#1d4ed8';
      const lineWidth = Number(layer.style?.lineWidth || 7);
      const xA = xMin;
      const xB = xMax;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.beginPath();
      ctx.moveTo(toX(xA), toY(slope * xA + intercept));
      ctx.lineTo(toX(xB), toY(slope * xB + intercept));
      ctx.stroke();
      const label = applyLabelTemplate(layer.labelTemplate || layer.label, { slopeRaw, interceptRaw });
      if (label && layer.showInLegend !== false) legendItems.push({ type: 'line', color, label, lineWidth });
    }
  });

  if (legendItems.length) {
    const legendX = plotLeft + 24;
    let legendY = plotTop + 24;
    const legendWidth = Math.min(620, Math.max(...legendItems.map(item => ctx.measureText(item.label).width + 120)));
    const legendHeight = legendItems.length * 58 + 28;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.strokeStyle = '#d1d5db';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(legendX, legendY, legendWidth, legendHeight, 10);
    ctx.fill();
    ctx.stroke();
    legendY += 48;
    ctx.font = '32px Arial, "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#111827';
    ctx.textAlign = 'left';
    legendItems.forEach((item) => {
      if (item.type === 'point') {
        ctx.fillStyle = item.color;
        ctx.beginPath();
        ctx.arc(legendX + 40, legendY, 13, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = item.color;
        ctx.lineWidth = item.lineWidth || 7;
        ctx.beginPath();
        ctx.moveTo(legendX + 18, legendY);
        ctx.lineTo(legendX + 72, legendY);
        ctx.stroke();
      }
      ctx.fillStyle = '#111827';
      ctx.fillText(item.label, legendX + 96, legendY + 2);
      legendY += 58;
    });
  }

  return canvasToFile(canvas, output.fileName || `${asset.targetNodeId || 'computed-plot'}.png`);
};

const drawExcelStyleChart = async (asset, values) => {
  const plot = asset.plot || {};
  const output = asset.output || {};
  const width = Number(output.width || plot.width || DEFAULT_EXCEL_CHART_WIDTH);
  const height = Number(output.height || plot.height || DEFAULT_EXCEL_CHART_HEIGHT);
  const margin = { ...DEFAULT_EXCEL_MARGIN, ...(plot.margin || {}) };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前浏览器不支持生成 Excel 风格曲线图');

  const axisPairs = finitePairs(valuesForSource(plot.xAxis, values), valuesForSource(plot.yAxis, values));
  if (axisPairs.length < 2) throw new Error('曲线图数据不足，至少需要两组有效点');

  const xDataMin = Math.min(...axisPairs.map(point => point.x));
  const xDataMax = Math.max(...axisPairs.map(point => point.x));
  const yDataMin = Math.min(...axisPairs.map(point => point.y));
  const yDataMax = Math.max(...axisPairs.map(point => point.y));
  const [xMin, xMax] = plot.xAxis?.range || padRange(xDataMin, xDataMax);
  const [yMin, yMax] = plot.yAxis?.range || padRange(yDataMin, yDataMax);

  const plotLeft = margin.left;
  const plotTop = margin.top;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const plotRight = plotLeft + plotWidth;
  const plotBottom = plotTop + plotHeight;
  const toX = (x) => plotLeft + ((x - xMin) / (xMax - xMin)) * plotWidth;
  const toY = (y) => plotBottom - ((y - yMin) / (yMax - yMin)) * plotHeight;

  const xTicks = Array.isArray(plot.xAxis?.ticks)
    ? plot.xAxis.ticks
    : Array.from({ length: 7 }, (_, index) => xMin + ((xMax - xMin) * index) / 6);
  const yTicks = Array.isArray(plot.yAxis?.ticks)
    ? plot.yAxis.ticks
    : Array.from({ length: 6 }, (_, index) => yMin + ((yMax - yMin) * index) / 5);
  const titleFont = plot.style?.titleFont || 'bold 30px Arial, "Microsoft YaHei", sans-serif';
  const tickFont = plot.style?.tickFont || '28px Arial, "Microsoft YaHei", sans-serif';
  const axisLabelFont = plot.style?.axisLabelFont || '32px Arial, "Microsoft YaHei", sans-serif';
  const legendFont = plot.style?.legendFont || 'bold 22px Arial, "Microsoft YaHei", sans-serif';

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);

  ctx.font = titleFont;
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(plot.title || '曲线图', width / 2, Number(plot.style?.titleY || 34));

  ctx.strokeStyle = plot.style?.gridColor || '#e6e6e6';
  ctx.lineWidth = Number(plot.style?.gridLineWidth || 2);
  ctx.setLineDash([]);
  xTicks.forEach((tick) => {
    const x = toX(Number(tick));
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotBottom);
    ctx.stroke();
  });
  yTicks.forEach((tick) => {
    const y = toY(Number(tick));
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
  });

  const legendItems = [];
  (plot.referenceLines || []).forEach((line) => {
    if (line.axis !== 'y') return;
    const y = toY(Number(line.value));
    const style = line.style || {};
    const color = style.color || '#d62728';
    const dash = style.dash || [12, 8];
    const lineWidth = Number(style.lineWidth || 3);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(dash);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotRight, y);
    ctx.stroke();
    if (line.label) legendItems.push({ type: 'line', color, label: line.label, lineWidth, dash });
  });
  ctx.setLineDash([]);

  ctx.strokeStyle = plot.style?.borderColor || '#111';
  ctx.lineWidth = Number(plot.style?.borderWidth || 3);
  ctx.strokeRect(plotLeft, plotTop, plotWidth, plotHeight);

  ctx.fillStyle = '#111';
  ctx.font = tickFont;
  ctx.textBaseline = 'middle';
  xTicks.forEach((tick) => {
    const x = toX(Number(tick));
    ctx.textAlign = 'center';
    ctx.fillText(formatNumberLabel(tick), x, plotBottom + 35);
  });
  yTicks.forEach((tick) => {
    const y = toY(Number(tick));
    ctx.textAlign = 'right';
    ctx.fillText(formatNumberLabel(tick), plotLeft - 24, y);
  });

  ctx.font = axisLabelFont;
  ctx.textAlign = 'center';
  ctx.fillText(plot.xAxis?.label || '', plotLeft + plotWidth / 2, height - 37);
  ctx.save();
  ctx.translate(39, plotTop + plotHeight / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(plot.yAxis?.label || '', 0, 0);
  ctx.restore();

  const seriesLayer = (plot.layers || []).find(layer => layer.type === 'polyline') || {};
  const seriesPairs = finitePairs(
    valuesForSource({ values: seriesLayer.xValues || plot.xAxis?.values, nodes: seriesLayer.xNodes || plot.xAxis?.nodes }, values),
    valuesForSource({ values: seriesLayer.yValues || plot.yAxis?.values, nodes: seriesLayer.yNodes || plot.yAxis?.nodes }, values),
  );
  const seriesStyle = seriesLayer.style || {};
  const seriesColor = seriesStyle.color || '#3569ad';
  const seriesLineWidth = Number(seriesStyle.lineWidth || 6);
  ctx.strokeStyle = seriesColor;
  ctx.lineWidth = seriesLineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  drawDataPath(ctx, seriesPairs, toX, toY, seriesStyle.curve === 'smooth', Number(seriesStyle.tension || 0.12));
  ctx.stroke();
  ctx.fillStyle = seriesColor;
  const markerRadius = Number(seriesStyle.markerRadius || 5);
  if (markerRadius > 0) {
    seriesPairs.forEach((point) => {
      ctx.beginPath();
      ctx.arc(toX(point.x), toY(point.y), markerRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  if (seriesLayer.label && seriesLayer.showInLegend !== false) {
    legendItems.unshift({ type: 'line', color: seriesColor, label: seriesLayer.label, lineWidth: seriesLineWidth });
  }

  if (legendItems.length) {
    ctx.font = legendFont;
    const paddingX = 16;
    const itemHeight = 36;
    const legendWidth = Math.min(
      310,
      Math.max(...legendItems.map(item => ctx.measureText(item.label).width + 96)),
    );
    const legendHeight = legendItems.length * itemHeight + 18;
    const legendX = plotRight - legendWidth - 12;
    let legendY = plotTop + 10;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.strokeStyle = '#d9d9d9';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(legendX, legendY, legendWidth, legendHeight, 8);
    ctx.fill();
    ctx.stroke();
    legendY += 27;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    legendItems.forEach((item) => {
      ctx.strokeStyle = item.color;
      ctx.lineWidth = item.lineWidth || 3;
      ctx.setLineDash(item.dash || []);
      ctx.beginPath();
      ctx.moveTo(legendX + paddingX, legendY);
      ctx.lineTo(legendX + paddingX + 44, legendY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#111';
      ctx.fillText(item.label, legendX + paddingX + 68, legendY + 1);
      legendY += itemHeight;
    });
  }

  return canvasToFile(canvas, output.fileName || `${asset.targetNodeId || 'excel-style-chart'}.png`);
};

export async function generateComputedImageAssets({ experiment, values }) {
  if (typeof document === 'undefined') return [];
  const assetEntries = Object.entries(experiment?.computedAssets || {});
  const generated = [];
  for (const [targetNodeId, rawAsset] of assetEntries) {
    const asset = { ...rawAsset, targetNodeId: rawAsset.targetNodeId || targetNodeId };
    if (asset.type !== 'image') continue;
    let file = null;
    if (asset.generator === 'canvas_plot') file = await drawPlot(asset, values);
    if (asset.generator === 'excel_style_chart') file = await drawExcelStyleChart(asset, values);
    if (!file) continue;
    generated.push({
      targetNodeId: asset.targetNodeId,
      imageSlotId: asset.imageSlotId,
      file,
    });
  }
  return generated;
}
