import React from 'react';
import { Input } from 'antd';
import { ReviewerNodeHint } from './ReviewerNodeHint.jsx';

export function ExperimentDataTable({ dataTable, formValues, onFieldChange, metaInfo, showNodeHints = false, highlightedNodeIds }) {
  const renderNodeHint = (nodeId) => {
    if (!showNodeHints) return null;
    return (
      <ReviewerNodeHint
        nodeId={nodeId}
        meta={metaInfo?.nodeMetaMap?.[nodeId]}
        value={formValues?.[nodeId]}
      />
    );
  };

  const renderNodeInput = (nodeId, inputProps = {}, wrapperStyle = {}, key) => {
    const isComputed = metaInfo?.computedIds?.has(nodeId);
    const isHighlighted = highlightedNodeIds?.has?.(nodeId);
    return (
      <div
        key={key}
        className={`reviewer-node-input-wrap ${isHighlighted ? 'is-calc-missing-cell' : ''}`}
        style={wrapperStyle}
      >
        <Input
          {...inputProps}
          data-node-id={nodeId}
          className={`${isComputed ? 'is-computed' : ''} ${isHighlighted ? 'is-calc-missing' : ''} ${inputProps.className || ''}`.trim()}
          value={formValues?.[nodeId] ?? ''}
          onChange={(e) => onFieldChange?.(nodeId, e.target.value)}
          title={showNodeHints ? `节点: ${nodeId}` : undefined}
        />
        {renderNodeHint(nodeId)}
      </div>
    );
  };

  if (Array.isArray(dataTable.rows) && dataTable.rows.length > 0) {
    const maxColumns = Math.max(
      1,
      ...dataTable.rows.map((row) => (row.cells || []).reduce((sum, cell) => sum + (cell.colSpan || 1), 0)),
    );

    return (
      <div className="experiment-data-panel">
        <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#141413' }}>{dataTable.caption || '实验数据表'}</h3>
        <div className="experiment-data-table">
          {dataTable.rows.map((row, rowIdx) => (
            <div
              className={`experiment-data-row${row.isHeader ? ' is-head' : ''}`}
              key={rowIdx}
              style={{ gridTemplateColumns: `repeat(${maxColumns}, minmax(0, 1fr))` }}
            >
              {(row.cells || []).map((cell, cellIdx) => {
                const gridColumn = cell.colSpan ? `span ${cell.colSpan}` : undefined;
                if (cell.nodeId) {
                  return renderNodeInput(cell.nodeId, { placeholder: cell.text || '' }, { gridColumn }, cellIdx);
                }
                return (
                  <span key={cellIdx} style={{ gridColumn }}>
                    {cell.text || ''}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const colsCount = dataTable.columns?.length || 0;
  const gridTemplateColumns = `80px repeat(${colsCount - 1}, minmax(0, 1fr))`;
  const rowCount = dataTable.rowCount || 5;
  const rowLabels = dataTable.rowLabels || ['1', '2', '3', '4', '5'];

  return (
    <div className="experiment-data-panel">
      <h3 style={{ margin: '0 0 16px 0', fontSize: '15px', color: '#141413' }}>{dataTable.caption || '实验数据表'}</h3>
      <div className="experiment-data-table">
        <div className="experiment-data-row is-head" style={{ gridTemplateColumns }}>
          {dataTable.columns?.map((col, idx) => (
            <span key={idx}>{col.text || ''}</span>
          ))}
        </div>
        {[...Array(rowCount)].map((_, i) => {
          const rowIdx = i + 1;
          const rowLabel = rowLabels[i] || rowIdx;
          return (
            <div className="experiment-data-row" key={rowIdx} style={{ gridTemplateColumns }}>
              <span>{rowLabel}</span>
              {dataTable.columns?.slice(1).map((col, cIdx) => {
                const pattern = col.nodePattern;
                if (!pattern) return <span key={cIdx}></span>;
                const sampleNode = pattern.includes('{') ? pattern.replace(/\{.*\}/, rowIdx.toString()) : pattern;
                return renderNodeInput(sampleNode, {}, {}, cIdx);
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
