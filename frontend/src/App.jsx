import React, { Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Spin } from 'antd';
import LandingPage from './pages/LandingPage.jsx';
import WorkspaceLayout from './pages/WorkspaceLayout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import WorkspaceBlankPage from './pages/workspace/WorkspaceBlankPage.jsx';
import DesignSystemPage from './pages/workspace/DesignSystemPage.jsx';

// Lazy load role-based workspace pages
const StudentDashboardPage = React.lazy(() => import('./pages/workspace/student/StudentDashboardPage.jsx'));
const StudentExperimentsPage = React.lazy(() => import('./pages/workspace/student/StudentExperimentsPage.jsx'));
const StudentExperimentDetailPage = React.lazy(() => import('./pages/workspace/student/StudentExperimentDetailPage.jsx'));
const StudentFeedbackPage = React.lazy(() => import('./pages/workspace/student/StudentFeedbackPage.jsx'));

const ReviewerTasksPage = React.lazy(() => import('./pages/workspace/reviewer/ReviewerTasksPage.jsx'));
const ReviewerTaskDetailPage = React.lazy(() => import('./pages/workspace/reviewer/ReviewerTaskDetailPage.jsx'));

const AdminOperationLogsPage = React.lazy(() => import('./pages/workspace/admin/AdminOperationLogsPage.jsx'));
const SettingsPage = React.lazy(() => import('./pages/workspace/admin/SettingsPage.jsx'));
const ExperimentConfigPage = React.lazy(() => import('./pages/workspace/admin/ExperimentConfigPage.jsx'));
const AdminOrdersPage = React.lazy(() => import('./pages/workspace/admin/AdminOrdersPage.jsx'));
const AdminExperimentPreviewPage = React.lazy(() => import('./pages/workspace/admin/AdminExperimentPreviewPage.jsx'));
const AdminFeedbackPage = React.lazy(() => import('./pages/workspace/admin/AdminFeedbackPage.jsx'));
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
              <ReviewerTasksPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="reviewer/tasks/:taskId"
          element={
            <RequireWorkspaceRole moduleId="reviewer-tasks">
              <ReviewerTaskDetailPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/operation-logs"
          element={
            <RequireWorkspaceRole moduleId="admin-operation-logs">
              <AdminOperationLogsPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/review-tasks"
          element={
            <RequireWorkspaceRole moduleId="admin-review-tasks">
              <WorkspaceBlankPage />
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
        <Route
          path="admin/experiments"
          element={
            <RequireWorkspaceRole moduleId="admin-experiments">
              <ExperimentConfigPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/orders"
          element={
            <RequireWorkspaceRole moduleId="admin-orders">
              <AdminOrdersPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/experiments/:experimentId/preview"
          element={
            <RequireWorkspaceRole moduleId="admin-experiments">
              <AdminExperimentPreviewPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/design-system"
          element={
            <RequireWorkspaceRole moduleId="design-system">
              <DesignSystemPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="admin/feedback"
          element={
            <RequireWorkspaceRole moduleId="admin-feedback">
              <AdminFeedbackPage />
            </RequireWorkspaceRole>
          }
        />
        <Route
          path="student/feedback"
          element={
            <RequireWorkspaceRole moduleId="student-feedback">
              <StudentFeedbackPage />
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
