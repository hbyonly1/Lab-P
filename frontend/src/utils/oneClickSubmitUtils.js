import { submitCheckout } from '../services/checkoutApi.js';

export const createSubmissionBatchId = () => `BATCH-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

export function collectBatchImagePaths(batchImages, experimentId) {
  const expImages = batchImages?.[experimentId] || {};
  return Object.values(expImages).flat().map((img) => img?.url).filter(Boolean);
}

export function collectBatchImageSlots(batchImages, experimentId) {
  const expImages = batchImages?.[experimentId] || {};
  return Object.fromEntries(
    Object.entries(expImages)
      .map(([slotId, files]) => [
        slotId,
        (files || [])
          .filter((img) => img?.url)
          .map((img, index) => ({
            uid: img.uid || `${slotId}-${index + 1}`,
            name: img.name || `图片 ${index + 1}`,
            url: img.url,
            sourceIndex: img.sourceIndex,
          })),
      ])
      .filter(([, files]) => files.length > 0)
  );
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

function resolveExperimentOption(option, experimentId, target, defaultValue) {
  if (typeof option === 'function') {
    const value = option(experimentId, target);
    return value ?? defaultValue;
  }
  if (option && typeof option === 'object' && !Array.isArray(option)) {
    return option[experimentId] ?? defaultValue;
  }
  return option ?? defaultValue;
}

export async function submitOneClickExperimentBatch({
  targets = [],
  batchImages = {},
  targetStudent = null,
  isHungup = false,
  planName = 'pay_per_use',
  fallbackImagePaths = {},
  imagePathsOverride = {},
  imageAssignmentConfirmed = true,
} = {}) {
  const targetsWithImages = targets
    .map((target) => {
      const experimentId = resolveExperimentId(target);
      const overrideImagePaths = resolveFallbackImagePaths(imagePathsOverride, experimentId, target);
      const modalImagePaths = collectBatchImagePaths(batchImages, experimentId);
      const imagePaths = overrideImagePaths.length > 0
        ? overrideImagePaths
        : modalImagePaths.length > 0
        ? modalImagePaths
        : resolveFallbackImagePaths(fallbackImagePaths, experimentId, target);
      const imageSlots = collectBatchImageSlots(batchImages, experimentId);
      const confirmed = Boolean(resolveExperimentOption(imageAssignmentConfirmed, experimentId, target, true));
      return { experimentId, imagePaths, imageSlots, imageAssignmentConfirmed: confirmed };
    })
    .filter(({ experimentId, imagePaths }) => experimentId && imagePaths.length > 0);

  if (targetsWithImages.length === 0) {
    return { submissions: [], submittedCount: 0, submissionBatchId: null };
  }

  const submissionBatchId = createSubmissionBatchId();
  const checkout = await submitCheckout({
    plan: planName,
    experiments: targetsWithImages.map(({ experimentId, imagePaths, imageSlots, imageAssignmentConfirmed }) => ({
      experiment_id: experimentId,
      image_paths: imagePaths,
      image_slots: imageSlots,
      image_assignment_confirmed: imageAssignmentConfirmed,
    })),
    targetStudent,
    isHungup,
    submissionBatchId,
    clientRequestId: submissionBatchId,
  });

  return {
    submissions: checkout.submissions || [],
    submittedCount: (checkout.submissions || []).length,
    submissionBatchId: checkout.submission_batch_id || submissionBatchId,
    order: checkout.order || null,
    quote: checkout.quote || null,
  };
}
