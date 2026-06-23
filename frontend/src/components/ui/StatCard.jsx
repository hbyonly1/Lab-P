export default function StatCard({ icon, label, tone = 'blue', value }) {
  return (
    <article className={`ui-stat-card is-${tone}`}>
      <span className="ui-stat-card-icon">{icon}</span>
      <span className="ui-stat-card-copy">
        <span className="ui-stat-card-label">{label}</span>
        <strong className="ui-stat-card-value">{value}</strong>
      </span>
    </article>
  );
}
