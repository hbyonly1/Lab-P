import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import LandingPage from './pages/LandingPage.jsx';
import WorkspaceLayout from './pages/WorkspaceLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import StudentExperimentsPage from './pages/workspace/StudentExperimentsPage.jsx';
import StudentExperimentDetailPage from './pages/workspace/StudentExperimentDetailPage.jsx';
import StudentDashboardPage from './pages/workspace/StudentDashboardPage.jsx';
import WorkspacePlaceholderPage from './pages/workspace/WorkspacePlaceholderPage.jsx';
import SettingsPage from './pages/workspace/SettingsPage.jsx';
import { getAdminUserRole, hasAdminAccessToken } from './auth.js';
import {
  canAccessWorkspaceModule,
  getDefaultWorkspacePath,
  getWorkspaceModuleById,
} from './workspaceModules.jsx';

function RequireWorkspaceAuth({ children }) {
  const location = useLocation();

  if (!hasAdminAccessToken()) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

function RequireWorkspaceRole({ moduleId, children }) {
  const role = getAdminUserRole();
  const module = getWorkspaceModuleById(moduleId);

  if (!canAccessWorkspaceModule(module, role)) {
    return <Navigate to={getDefaultWorkspacePath(role)} replace />;
  }

  return children;
}

function WorkspaceIndex() {
  return <Navigate to={getDefaultWorkspacePath(getAdminUserRole())} replace />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/workspace"
        element={
          <RequireWorkspaceAuth>
            <WorkspaceLayout />
          </RequireWorkspaceAuth>
        }
      >
        <Route index element={<WorkspaceIndex />} />
        <Route
          path="student/dashboard"
          element={
            <RequireWorkspaceRole moduleId="student-dashboard">
              <StudentDashboardPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="student/experiments"
          element={
            <RequireWorkspaceRole moduleId="student-experiments">
              <StudentExperimentsPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="student/experiments/:experimentId"
          element={
            <RequireWorkspaceRole moduleId="student-experiments">
              <StudentExperimentDetailPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="reviewer/tasks"
          element={
            <RequireWorkspaceRole moduleId="reviewer-tasks">
              <WorkspacePlaceholderPage moduleId="reviewer-tasks" />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="reviewer/tasks/:taskId"
          element={
            <RequireWorkspaceRole moduleId="reviewer-tasks">
              <WorkspacePlaceholderPage moduleId="reviewer-tasks" />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/orders"
          element={
            <RequireWorkspaceRole moduleId="admin-orders">
              <WorkspacePlaceholderPage moduleId="admin-orders" />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/submissions"
          element={
            <RequireWorkspaceRole moduleId="admin-submissions">
              <WorkspacePlaceholderPage moduleId="admin-submissions" />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/review-tasks"
          element={
            <RequireWorkspaceRole moduleId="admin-review-tasks">
              <WorkspacePlaceholderPage moduleId="admin-review-tasks" />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/settings"
          element={
            <RequireWorkspaceRole moduleId="settings">
              <SettingsPage />
            </RequireWorkspaceRole>
          }
        />
      </Route>
      <Route path="/admin/*" element={<Navigate to="/workspace" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
