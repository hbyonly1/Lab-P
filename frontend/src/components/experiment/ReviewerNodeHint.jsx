import React from 'react';
import { Popover, Tag } from 'antd';

const TYPE_LABELS = {
  extract: '识别/填写',
  fixed: '固定填空',
  computed: '公式计算',
  async: '异步生成',
  generated: '生成式回答',
  ai_recognize: 'AI 图像识别',
  image_upload: '图片上传',
};

function InfoRow({ label, value }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="reviewer-node-hint-row">
      <span>{label}</span>
      <code>{String(value)}</code>
    </div>
  );
}

export function ReviewerNodeHint({ nodeId, meta, value, children }) {
  if (!nodeId) return null;

  const resolvedMeta = meta || { nodeId };
  const typeLabel = TYPE_LABELS[resolvedMeta.type] || resolvedMeta.type || '未分类';
  const fixedValue = resolvedMeta.fixedValue;
  const formula = resolvedMeta.formula || (resolvedMeta.type === 'computed' ? '未配置' : '');

  const content = (
    <div className="reviewer-node-hint-popover">
      <InfoRow label="节点名" value={nodeId} />
      <InfoRow label="类型" value={typeLabel} />
      <InfoRow label="位置" value={resolvedMeta.sectionTitle || resolvedMeta.tableCaption || resolvedMeta.source} />
      <InfoRow label="固定答案" value={fixedValue} />
      <InfoRow label="公式" value={formula} />
      <InfoRow label="当前值" value={value} />
    </div>
  );

  if (children) {
    return (
      <Popover content={content} trigger="hover" placement="top">
        {children}
      </Popover>
    );
  }

  return (
    <Popover content={content} trigger="hover" placement="top">
      <Tag className="reviewer-node-hint-tag">{nodeId}</Tag>
    </Popover>
  );
}
