export default function PageHeading({ actions, children, description, title }) {
  return (
    <header className="ui-page-heading">
      <div className="ui-page-heading-copy">
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-heading-actions">{actions}</div> : null}
      {children}
    </header>
  );
}
