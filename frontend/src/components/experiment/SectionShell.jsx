import React from 'react';

export function SectionShell({ index, title, locked, children, extra }) {
  return (
    <section className={`experiment-edit-section${locked ? ' is-locked' : ''}`}>
      <div className="experiment-section-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>
          {index && <span className="section-index" style={{ marginRight: '8px' }}>{index}</span>}
          {title}
        </h2>
        {extra && <div className="section-extra">{extra}</div>}
      </div>
      <div className="experiment-section-content">{children}</div>
    </section>
  );
}
