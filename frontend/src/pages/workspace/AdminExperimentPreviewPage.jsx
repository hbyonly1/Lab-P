import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { buildExperimentPreviewConfig, findExperimentProfile } from './experimentConfigStore.js';
import { ExperimentDetailView } from './StudentExperimentDetailPage.jsx';

export default function AdminExperimentPreviewPage() {
  const navigate = useNavigate();
  const { experimentId } = useParams();
  const [previewDisplayMode, setPreviewDisplayMode] = useState('empty');
  const record = findExperimentProfile(experimentId);

  if (!record) {
    return <Navigate to="/workspace/admin/experiments" replace />;
  }

  const previewConfig = buildExperimentPreviewConfig(record.profile);

  return (
    <ExperimentDetailView
      experiment={{
        id: record.id,
        name: record.name,
        status: 'not_started',
        ...previewConfig,
      }}
      onBack={() => navigate('/workspace/admin/experiments')}
      previewDisplayMode={previewDisplayMode}
      previewMode
      onPreviewDisplayModeChange={setPreviewDisplayMode}
    />
  );
}
