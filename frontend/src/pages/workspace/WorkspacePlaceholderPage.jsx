import { getWorkspaceModuleById } from '../../workspaceModules.jsx';

export default function WorkspacePlaceholderPage({ moduleId }) {
  const module = getWorkspaceModuleById(moduleId);

  return (
    <section className="workspace-empty-panel">
      <span className="section-eyebrow">• COMING SOON</span>
      <h2>{module.title}</h2>
      <p>{module.description}</p>
    </section>
  );
}
