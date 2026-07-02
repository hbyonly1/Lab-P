import { apiClient } from './apiClient.js';

export async function createOrder(payload) {
  const response = await apiClient.post('/api/v1/orders/', payload);
  return response.data;
}

export async function getOrders() {
  const response = await apiClient.get('/api/v1/orders/');
  return response.data;
}

export async function verifyOrderPayment(orderId, action) {
  const response = await apiClient.post(`/api/v1/orders/${orderId}/verify`, { action });
  return response.data;
}
