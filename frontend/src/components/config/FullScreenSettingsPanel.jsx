import React from 'react';

export function FullScreenSettingsPanel({ children, actions, description, className = '' }) {
  return (
    <section 
      className={`settings-panel settings-automation-panel ${className}`}
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      {description && (
        <div className="settings-panel-description" style={{ marginBottom: 16 }}>
          {description}
        </div>
      )}
      <div 
        className="settings-panel-content" 
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}
      >
        {children}
      </div>
      {actions && (
        <div className="settings-actions" style={{ marginTop: 16 }}>
          {actions}
        </div>
      )}
    </section>
  );
}
