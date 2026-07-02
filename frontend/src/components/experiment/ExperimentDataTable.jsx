import React from 'react';
import { Input } from 'antd';

export function ExperimentDataTable({ dataTable, formValues, onFieldChange, metaInfo }) {
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
                  const isComputed = metaInfo?.computedIds?.has(cell.nodeId);
                  return (
                    <Input
                      key={cellIdx}
                      className={isComputed ? 'is-computed' : ''}
                      style={{ gridColumn }}
                      value={formValues?.[cell.nodeId] ?? ''}
                      placeholder={cell.label || ''}
                      onChange={(e) => onFieldChange?.(cell.nodeId, e.target.value)}
                      title={`节点: ${cell.nodeId}`}
                    />
                  );
                }
                return (
                  <span key={cellIdx} style={{ gridColumn }}>
                    {cell.label || ''}
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
            <span key={idx}>{col.label}</span>
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
                const isComputed = metaInfo?.computedIds?.has(sampleNode);
                return (
                  <Input
                    key={cIdx}
                    className={isComputed ? 'is-computed' : ''}
                    value={formValues?.[sampleNode] ?? ''}
                    onChange={e => onFieldChange?.(sampleNode, e.target.value)}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
