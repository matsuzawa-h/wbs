import axios, { AxiosInstance } from 'axios';

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      console.error(
        `[API] ${error.config?.method?.toUpperCase()} ${error.config?.url} ${error.response.status}`,
        error.response.data,
      );
    } else {
      console.error('[API] network error', error.message);
    }
    return Promise.reject(error);
  },
);
