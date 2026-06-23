export default function StatusBadge({ children, label, tone = 'pending' }) {
  return (
    <span className={`ui-status-badge is-${tone}`}>
      <i className="ui-status-badge-dot" aria-hidden="true" />
      {children ?? label}
    </span>
  );
}
