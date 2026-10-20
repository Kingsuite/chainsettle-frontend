/**
 * lib/api/client.ts
 *
 * Axios instance pre-configured for the ChainSettle backend.
 * Automatically attaches the JWT token from localStorage to every request.
 * On 401, ends the session once and redirects to login with a callbackUrl.
 */

import axios from 'axios';
import { endSession } from '@/lib/auth/session';
import { env } from '@/lib/env';

const BASE_URL = env.apiUrl;

export const apiClient = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
});

// Attach JWT on every request
apiClient.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('chainsetttle_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// Endpoints that are part of the sign-in flow itself. A 401 here means the
// signature/nonce was rejected and should surface as a login error, not
// trigger a "session expired" redirect.
const AUTH_FLOW_PATHS = ['/auth/nonce', '/auth/login'];

function isAuthFlowRequest(url: string | undefined): boolean {
  if (!url) return false;
  return AUTH_FLOW_PATHS.some((path) => url.includes(path));
}

// Handle 401 — end the session (deduplicated) and redirect to login
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      error.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !isAuthFlowRequest(error.config?.url)
    ) {
      endSession('expired');
    }
    return Promise.reject(error);
  },
);
