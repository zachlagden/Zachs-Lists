import axios, { type AxiosRequestConfig } from 'axios';
import { toApiError } from './errors';

export const API_BASE: string = import.meta.env.VITE_API_URL || '';
export const REQUEST_TIMEOUT_MS = 20_000;

const SESSION_CHECK_PATH = '/api/auth/me';

export const http = axios.create({
  baseURL: API_BASE,
  withCredentials: true,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function onUnauthorized(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      const isSessionCheck = error.config?.url?.includes(SESSION_CHECK_PATH) ?? false;
      if (!isSessionCheck) unauthorizedHandler?.();
    }
    return Promise.reject(error);
  },
);

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const response = await http.request<T>(config);
    return response.data;
  } catch (error) {
    throw toApiError(error);
  }
}

export function get<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return request<T>({ method: 'GET', url, params });
}

export function post<T>(url: string, data?: unknown): Promise<T> {
  return request<T>({ method: 'POST', url, data });
}

export function put<T>(url: string, data?: unknown): Promise<T> {
  return request<T>({ method: 'PUT', url, data });
}

export function del<T>(url: string): Promise<T> {
  return request<T>({ method: 'DELETE', url });
}
