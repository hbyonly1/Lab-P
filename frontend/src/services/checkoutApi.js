import { apiClient } from './apiClient.js';

export async function quoteCheckout({ plan, experiments = [] }) {
  const response = await apiClient.post('/api/v1/checkout/quote', {
    plan,
    experiments,
  });
  return response.data;
}

export async function submitCheckout({
  plan,
  experiments = [],
  targetStudent = null,
  isHungup = false,
  submissionBatchId = null,
  clientRequestId = null,
}) {
  const payload = {
    plan,
    experiments,
    is_hungup: isHungup,
  };
  if (targetStudent) payload.target_student = targetStudent;
  if (submissionBatchId) payload.submission_batch_id = submissionBatchId;
  if (clientRequestId) payload.client_request_id = clientRequestId;

  const response = await apiClient.post('/api/v1/checkout/submit', payload);
  return response.data;
}
