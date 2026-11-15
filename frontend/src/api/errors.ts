import { isAxiosError } from 'axios';
import { formatDuration } from '../lib/format';

export interface ApiErrorBody {
  error?: string;
  code?: string;
  field?: string | null;
  details?: string[];
  retry_after?: number;
  cooldown_remaining?: number;
  [key: string]: unknown;
}

export type ApiErrorKind = 'http' | 'network' | 'timeout';

interface ApiErrorInit {
  kind: ApiErrorKind;
  message: string;
  status?: number;
  code?: string;
  field?: string;
  body?: ApiErrorBody;
  retryAfterSeconds?: number;
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  readonly code: string | null;
  readonly field: string | null;
  readonly body: ApiErrorBody;
  readonly retryAfterSeconds: number | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.kind = init.kind;
    this.status = init.status ?? null;
    this.code = init.code ?? null;
    this.field = init.field ?? null;
    this.body = init.body ?? {};
    this.retryAfterSeconds = init.retryAfterSeconds ?? null;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isClientError(): boolean {
    return this.status !== null && this.status >= 400 && this.status < 500;
  }
}

function asBody(data: unknown): ApiErrorBody {
  return data !== null && typeof data === 'object' ? (data as ApiErrorBody) : {};
}

function positiveSeconds(value: unknown): number | null {
  const seconds = typeof value === 'string' ? Number.parseInt(value, 10) : value;
  return typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function retryAfterSeconds(
  header: unknown,
  body: ApiErrorBody,
  now: Date = new Date(),
): number | null {
  const fromSeconds =
    positiveSeconds(header) ??
    positiveSeconds(body.retry_after) ??
    positiveSeconds(body.cooldown_remaining);
  if (fromSeconds !== null) return fromSeconds;
  if (typeof header !== 'string') return null;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.max(1, Math.ceil((date - now.getTime()) / 1000));
}

const STATUS_FALLBACKS: Record<number, string> = {
  401: 'Your session has ended. Sign in again.',
  403: 'You do not have access to this.',
  404: 'This could not be found.',
  429: 'Too many requests.',
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!isAxiosError(error)) {
    return new ApiError({
      kind: 'network',
      message: error instanceof Error ? error.message : 'Something went wrong.',
    });
  }
  if (!error.response) {
    const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
    return new ApiError({
      kind: timedOut ? 'timeout' : 'network',
      message: timedOut
        ? 'The server took too long to answer.'
        : 'Could not reach the server. Check your connection.',
    });
  }
  const { status, data, headers } = error.response;
  const body = asBody(data);
  const details = Array.isArray(body.details)
    ? body.details.filter((detail): detail is string => typeof detail === 'string')
    : [];
  const base =
    typeof body.error === 'string' && body.error
      ? body.error
      : (STATUS_FALLBACKS[status] ?? 'The server could not complete the request.');
  return new ApiError({
    kind: 'http',
    status,
    message: details.length > 0 ? `${base}: ${details.join(', ')}` : base,
    code: typeof body.code === 'string' ? body.code : undefined,
    field: typeof body.field === 'string' ? body.field : undefined,
    body,
    retryAfterSeconds:
      status === 429 ? (retryAfterSeconds(headers?.['retry-after'], body) ?? undefined) : undefined,
  });
}

function withFullStop(message: string): string {
  return /[.!?]$/.test(message) ? message : `${message}.`;
}

export function describeApiError(error: unknown, fallback: string): string {
  const apiError = toApiError(error);
  if (apiError.kind !== 'http') return apiError.message || fallback;
  if (apiError.isRateLimited && apiError.retryAfterSeconds !== null) {
    return `${withFullStop(apiError.message)} Try again in ${formatDuration(apiError.retryAfterSeconds)}.`;
  }
  if (apiError.status !== null && apiError.status >= 500 && !apiError.body.error) return fallback;
  return withFullStop(apiError.message);
}

export function shouldRetryRequest(failureCount: number, error: unknown): boolean {
  if (failureCount >= 1) return false;
  return !toApiError(error).isClientError;
}
