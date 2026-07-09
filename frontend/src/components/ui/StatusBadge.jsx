export default function StatusBadge({ children, indicator = 'dot', label, tone = 'pending' }) {
  return (
    <span className={`ui-status-badge is-${tone}`}>
      <i className={`ui-status-badge-dot is-${indicator}`} aria-hidden="true">
        {indicator === 'warning' ? '!' : null}
      </i>
      {children ?? label}
    </span>
  );
}
