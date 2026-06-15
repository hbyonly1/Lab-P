import { getWorkspaceModuleById } from '../../workspaceModules.jsx';
import WorkspacePlaceholderPage from './WorkspacePlaceholderPage.jsx';

export default function DashboardPage() {
  return <WorkspacePlaceholderPage module={getWorkspaceModuleById('dashboard')} />;
}
