const DEFAULT_PLOT_WIDTH = 1400;
const DEFAULT_PLOT_HEIGHT = 960;
const DEFAULT_MARGIN = { top: 110, right: 70, bottom: 115, left: 120 };

const numberFromValue = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).trim());
  return Number.isFinite(numeric) ? numeric : null;
};

const valuesForNodes = (values, nodes = []) => (
  (nodes || []).map(nodeId => numberFromValue(values?.[nodeId]))
);

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

  const axisXNodes = plot.xAxis?.nodes || [];
  const axisYNodes = plot.yAxis?.nodes || [];
  const axisPairs = finitePairs(valuesForNodes(values, axisXNodes), valuesForNodes(values, axisYNodes));
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

  ctx.font = '42px Arial, "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#111827';
  ctx.textAlign = 'center';
  ctx.fillText(plot.title || '拟合曲线', width / 2, 64);

  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 2;
  ctx.fillStyle = '#111827';
  ctx.font = '26px Arial, "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tickCount = 6;
  for (let i = 0; i < tickCount; i += 1) {
    const ratio = i / (tickCount - 1);
    const x = plotLeft + ratio * plotWidth;
    const xValue = xMin + ratio * (xMax - xMin);
    ctx.beginPath();
    ctx.moveTo(x, plotTop);
    ctx.lineTo(x, plotTop + plotHeight);
    ctx.stroke();
    ctx.fillText(Number(xValue.toPrecision(4)).toString(), x, plotTop + plotHeight + 34);

    const y = plotTop + plotHeight - ratio * plotHeight;
    const yValue = yMin + ratio * (yMax - yMin);
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(plotLeft + plotWidth, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(Number(yValue.toPrecision(4)).toString(), plotLeft - 20, y);
    ctx.textAlign = 'center';
  }

  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 4;
  ctx.strokeRect(plotLeft, plotTop, plotWidth, plotHeight);

  ctx.font = '32px Arial, "Microsoft YaHei", sans-serif';
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
        valuesForNodes(values, layer.xNodes || axisXNodes),
        valuesForNodes(values, layer.yNodes || axisYNodes),
      );
      const color = layer.style?.color || '#e3332a';
      ctx.fillStyle = color;
      layerPairs.forEach((point) => {
        ctx.beginPath();
        ctx.arc(toX(point.x), toY(point.y), Number(layer.style?.radius || 11), 0, Math.PI * 2);
        ctx.fill();
      });
      if (layer.label) legendItems.push({ type: 'point', color, label: layer.label });
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
      if (label) legendItems.push({ type: 'line', color, label, lineWidth });
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

export async function generateComputedImageAssets({ experiment, values }) {
  if (typeof document === 'undefined') return [];
  const assetEntries = Object.entries(experiment?.computedAssets || {});
  const generated = [];
  for (const [targetNodeId, rawAsset] of assetEntries) {
    const asset = { ...rawAsset, targetNodeId: rawAsset.targetNodeId || targetNodeId };
    if (asset.type !== 'image' || asset.generator !== 'canvas_plot') continue;
    const file = await drawPlot(asset, values);
    generated.push({
      targetNodeId: asset.targetNodeId,
      imageSlotId: asset.imageSlotId,
      file,
    });
  }
  return generated;
}
