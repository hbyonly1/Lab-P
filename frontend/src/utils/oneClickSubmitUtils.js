import { createSubmissionBatchId, submitExperiment } from '../services/submissionsApi.js';

export function collectBatchImagePaths(batchImages, experimentId) {
  const expImages = batchImages?.[experimentId] || {};
  return Object.values(expImages).flat().map((img) => img?.url).filter(Boolean);
}

function resolveExperimentId(target) {
  return target?.id || target?.meta?.id;
}

function resolveFallbackImagePaths(fallbackImagePaths, experimentId, target) {
  const paths = typeof fallbackImagePaths === 'function'
    ? fallbackImagePaths(experimentId, target)
    : fallbackImagePaths?.[experimentId];
  return (paths || []).filter(Boolean);
}

export async function submitOneClickExperimentBatch({
  targets = [],
  batchImages = {},
  targetStudent = null,
  isHungup = false,
  planName = 'pay_per_use',
  fallbackImagePaths = {},
} = {}) {
  const targetsWithImages = targets
    .map((target) => {
      const experimentId = resolveExperimentId(target);
      const modalImagePaths = collectBatchImagePaths(batchImages, experimentId);
      const imagePaths = modalImagePaths.length > 0
        ? modalImagePaths
        : resolveFallbackImagePaths(fallbackImagePaths, experimentId, target);
      return { experimentId, imagePaths };
    })
    .filter(({ experimentId, imagePaths }) => experimentId && imagePaths.length > 0);

  if (targetsWithImages.length === 0) {
    return { submissions: [], submittedCount: 0, submissionBatchId: null };
  }

  const submissionBatchId = createSubmissionBatchId();
  const submissions = [];
  for (const { experimentId, imagePaths } of targetsWithImages) {
    const submission = await submitExperiment(
      experimentId,
      targetStudent,
      isHungup,
      imagePaths,
      planName,
      submissionBatchId,
    );
    submissions.push(submission);
  }

  return {
    submissions,
    submittedCount: submissions.length,
    submissionBatchId,
  };
}
