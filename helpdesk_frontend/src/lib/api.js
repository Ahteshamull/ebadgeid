import axios from 'axios';
import { API_BASE_URL } from './config';
import { apiUrl, shouldRedirectForSession } from './api-url.mjs';

export async function apiFetch(path, options = {}) {
  const { redirectOnUnauthorized = true, ...fetchOptions } = options;
  const response = await fetch(apiUrl(API_BASE_URL, path), {
    ...fetchOptions,
    credentials: 'include',
    headers: {
      ...(fetchOptions.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(fetchOptions.headers || {})
    }
  });
  if (redirectOnUnauthorized && shouldRedirectForSession(response.status) && typeof window !== 'undefined') {
    window.location.href = '/auth/login';
  }
  return response;
}

export const apiClient = axios.create({ baseURL: API_BASE_URL, withCredentials: true });
apiClient.interceptors.response.use(
  response => response,
  error => {
    if ((error.response?.status === 401 || error.response?.status === 403) && typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }
    return Promise.reject(error);
  }
);
