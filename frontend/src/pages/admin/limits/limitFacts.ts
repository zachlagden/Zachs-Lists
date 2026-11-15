import type { StatusDescription } from '../../../components/ui/status';
import { formatDecimal, formatInteger, parseApiDate } from '../../../lib/format';
import type { AdminLimitReview, Job, LimitRequest } from '../../../types';

export const MAX_RESOLVE_REASON_LENGTH = 200;
export const MAX_RESPONSE_LENGTH = 1000;

export function methodLabel(method: string | null): string {
  if (method === 'exact') return 'Counted from the list files';
  if (method === 'build') return 'Counted by a build';
  if (method === 'stored') return 'Estimated from stored counts';
  return method ?? 'Not recorded';
}

export function percentOverText(percentOver: number): string {
  return `${formatDecimal(percentOver)}%`;
}

export type Enforcement = 'on' | 'off' | 'loading' | 'unknown';

const ENFORCEMENT_SENTENCES: Record<Enforcement, string> = {
  on: 'Enforcement is on. A build over the limit fails and the account keeps its earlier lists.',
  off: 'Enforcement is off. A build over the limit completes with a warning.',
  loading: 'Checking whether the limit is enforced…',
  unknown: 'Whether the limit is enforced could not be loaded.',
};

export function enforcementSentence(enforcement: Enforcement): string {
  return ENFORCEMENT_SENTENCES[enforcement];
}

function time(value: string | null | undefined): number {
  return parseApiDate(value)?.getTime() ?? 0;
}

export function orderRequests(requests: LimitRequest[]): LimitRequest[] {
  const pending = requests
    .filter((request) => request.status === 'pending')
    .sort((a, b) => time(a.created_at) - time(b.created_at));
  const handled = requests
    .filter((request) => request.status !== 'pending')
    .sort((a, b) => time(b.reviewed_at ?? b.created_at) - time(a.reviewed_at ?? a.created_at));
  return [...pending, ...handled];
}

export type UsageSource = 'review' | 'build' | 'stored';

export interface RequestUsage {
  domains: number;
  source: UsageSource;
}

export const USAGE_SOURCE_LABELS: Record<UsageSource, string> = {
  review: 'Measured for the open limit review',
  build: 'Measured by the latest build',
  stored: 'Stored count at the time of the request, which leaves out the nsfw category',
};

export function requestUsage(
  request: Pick<LimitRequest, 'user_id' | 'current_usage'>,
  reviews: ReadonlyArray<Pick<AdminLimitReview, 'user_id' | 'actual_domains'>>,
  jobs: ReadonlyArray<Pick<Job, 'user_id' | 'result'>>,
): RequestUsage {
  const review = reviews.find((candidate) => candidate.user_id === request.user_id);
  if (review) return { domains: review.actual_domains, source: 'review' };
  const measured = jobs.find(
    (job) =>
      job.user_id === request.user_id && typeof job.result?.limit?.actual_domains === 'number',
  );
  if (measured?.result?.limit) {
    return { domains: measured.result.limit.actual_domains, source: 'build' };
  }
  return { domains: request.current_usage, source: 'stored' };
}

const REQUEST_STATUS: Record<LimitRequest['status'], StatusDescription> = {
  pending: { tone: 'warn', icon: 'clock', label: 'Waiting' },
  approved: { tone: 'ok', icon: 'check', label: 'Approved' },
  denied: { tone: 'fail', icon: 'fail', label: 'Denied' },
  superseded: { tone: 'neutral', icon: 'dash', label: 'Replaced' },
};

export function requestStatus(status: LimitRequest['status']): StatusDescription {
  return REQUEST_STATUS[status] ?? { tone: 'neutral', icon: 'dash', label: status };
}

export function customLimitRange(
  request: Pick<LimitRequest, 'current_limit'>,
  maximum: number | null,
): { min: number; max: number | null } {
  return { min: Math.max(1, request.current_limit), max: maximum };
}

export function customLimitError(
  value: string,
  range: { min: number; max: number | null },
): string | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return 'Enter a whole number of domains.';
  const limit = Number(trimmed);
  if (limit < range.min) return `Enter at least ${formatInteger(range.min)}, the current limit.`;
  if (range.max !== null && limit > range.max) {
    return `Enter at most ${formatInteger(range.max)}.`;
  }
  return null;
}

export function isAlreadyHandled(code: string | null): boolean {
  return code === 'already_handled';
}
