export default function TablePanel({ actions, children, description, title }) {
  return (
    <section className="ui-table-panel">
      {(title || description || actions) ? (
        <div className="ui-table-panel-header">
          <div className="ui-table-panel-title">
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="ui-table-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="ui-table-panel-body">{children}</div>
    </section>
  );
}
