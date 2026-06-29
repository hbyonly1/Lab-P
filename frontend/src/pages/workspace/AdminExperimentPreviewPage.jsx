import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { getExperimentConfig } from '../../services/experimentConfigStore.js';
import { ExperimentDetailView } from './StudentExperimentDetailPage.jsx';

export default function AdminExperimentPreviewPage() {
  const navigate = useNavigate();
  const { experimentId } = useParams();
  
  // 直接通过 V2 Config Store 获取真实配置
  const experiment = getExperimentConfig(experimentId);

  if (!experiment) {
    return <Navigate to="/workspace/admin/experiments" replace />;
  }

  return (
    <ExperimentDetailView
      experiment={experiment}
      onBack={() => navigate('/workspace/admin/experiments')}
    />
  );
}
