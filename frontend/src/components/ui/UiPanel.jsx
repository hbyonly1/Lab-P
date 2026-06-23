export default function UiPanel({ children, className = '' }) {
  return <section className={['ui-panel', className].filter(Boolean).join(' ')}>{children}</section>;
}
