import { apiClient } from './apiClient.js';

export async function getOrders(params = {}) {
  const response = await apiClient.get('/api/v1/orders/', { params });
  return response.data;
}

export async function verifyOrderPayment(orderId, action) {
  const response = await apiClient.post(`/api/v1/orders/${orderId}/verify`, { action });
  return response.data;
}
