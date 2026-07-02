export default function UiPanel({ children, className = '', style }) {
  return <section className={['ui-panel', className].filter(Boolean).join(' ')} style={style}>{children}</section>;
}
