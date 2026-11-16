import axios from 'axios';

export const api = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1',
  withCredentials: false,
});

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('access_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const requestUrl = err.config?.url ?? '';
    const isPublicAuthRequest = /\/auth\/(login|register|refresh|logout)(?:\?|$)/.test(requestUrl);

    // Invalid credentials are an expected login response. Do not reload the
    // login page before its form can show the backend's useful error message.
    if (
      err.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !isPublicAuthRequest
    ) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('auth');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string') return message;
    return err.message;
  }
  return 'Unknown error';
}
