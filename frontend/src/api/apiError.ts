import { isAxiosError } from 'axios';

interface ApiErrorBody {
  error?: unknown;
  details?: unknown;
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError(error)) return fallback;
  const body = error.response?.data as ApiErrorBody | undefined;
  if (!body || typeof body.error !== 'string' || !body.error) return fallback;
  const details = Array.isArray(body.details)
    ? body.details.filter((detail): detail is string => typeof detail === 'string')
    : [];
  return details.length > 0 ? `${body.error}: ${details.join(', ')}` : body.error;
}
