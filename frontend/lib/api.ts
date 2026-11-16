import axios from 'axios';

// A production visitor cannot reach localhost on the server owner's machine.
// Use the BetPlatform API site as the production fallback if Netlify's
// NEXT_PUBLIC_API_URL is missing or was accidentally set to the local example.
const configuredApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim();
const isProduction = process.env.NODE_ENV === 'production';
const isLoopbackUrl = Boolean(
  configuredApiUrl &&
  /^https?:\/\/(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/i.test(configuredApiUrl),
);
const defaultApiUrl = isProduction
  ? 'https://betplatform-api.netlify.app/api/v1'
  : 'http://localhost:3000/api/v1';
const apiBaseUrl = (
  configuredApiUrl && !(isProduction && isLoopbackUrl)
    ? configuredApiUrl
    : defaultApiUrl
).replace(/\/+$/, '');

export const api = axios.create({
  baseURL: apiBaseUrl,
  timeout: 20_000,
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
    const isPublicAuthRequest = /\\/auth\\/(login|register|refresh|logout)(?:\\?|$)/.test(requestUrl);

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
    if (!err.response && err.code === 'ERR_NETWORK') {
      return 'BetPlatform could not reach its server. Please refresh and try again.';
    }
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return 'The BetPlatform server took too long to respond. Please try again.';
    }
    return err.message;
  }
  return 'Unknown error';
}
