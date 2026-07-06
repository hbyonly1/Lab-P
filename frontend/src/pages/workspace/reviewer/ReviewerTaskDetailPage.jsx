import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Button, message, Spin } from 'antd';
import { buildExperimentConfig } from '../../../services/experimentConfigStore.js';
import { getSubmission } from '../../../services/submissionsApi.js';
import { ExperimentDetailView } from '../student/StudentExperimentDetailPage.jsx';
import { experimentsApi } from '../../../services/experimentsApi.js';

const unwrapSubmissionValues = (payload) => {
  const values = payload?.values && typeof payload.values === 'object' ? payload.values : payload;
  return Object.fromEntries(
    Object.entries(values || {}).filter(([key]) => !['_meta', 'experiment_id', 'experiment_name'].includes(key))
  );
};

export default function ReviewerTaskDetailPage() {
  const { taskId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const experimentId = searchParams.get('exp');

  const [submission, setSubmission] = useState(null);
  const [experiment, setExperiment] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (taskId && experimentId) {
      Promise.all([
        getSubmission(taskId),
        experimentsApi.getExperimentConfig(experimentId),
      ])
        .then(([submissionRes, config]) => {
          setSubmission(submissionRes);
          setExperiment(buildExperimentConfig(config));
        })
        .catch(err => {
          message.error('无法获取任务信息: ' + (err.response?.data?.detail || err.message));
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [taskId, experimentId]);

  if (!experiment || (loading && !submission)) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', minHeight: '100vh', background: '#fafafc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {loading ? <Spin size="large" /> : (
          <>
            <h1 style={{ fontSize: '48px', color: '#ff4d4f', margin: '0' }}>403</h1>
            <h2 style={{ color: '#141413' }}>配置不存在或任务加载失败</h2>
            <p style={{ color: '#696969', maxWidth: '700px', margin: '16px auto' }}>
              当前请求的实验配置不存在，或者对应的审核任务已被删除。
            </p>
            <Button onClick={() => navigate('/workspace/reviewer/tasks')}>返回列表</Button>
          </>
        )}
      </div>
    );
  }

  // 计算初始的表单值。如果有已校正的优先用已校正，没有的话用机器识别的。
  const correctedValues = unwrapSubmissionValues(submission?.corrected_json);
  const recognizedValues = unwrapSubmissionValues(submission?.recognition_json);
  const initialFormValues = Object.keys(correctedValues || {}).length > 0
    ? correctedValues
    : (Object.keys(recognizedValues || {}).length > 0 ? recognizedValues : null);

  return (
    <ExperimentDetailView
      experiment={experiment}
      onBack={() => navigate('/workspace/reviewer/tasks')}
      isReviewer={true}
      initialSubmission={submission}
      initialImagePaths={submission?.image_paths || []}
      initialImageSlots={submission?.image_slots || {}}
      initialFormValues={initialFormValues}
    />
  );
}
