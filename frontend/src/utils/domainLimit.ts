import type { Job } from '../types';

export const DOMAIN_LIMIT_EXCEEDED = 'domain_limit_exceeded';
const OVER_THE_LIMIT_WORDING = ', which is over the limit of ';

export interface DomainLimitNotice {
  kind: 'failed' | 'warning';
  message: string;
}

export function domainLimitNotice(job: Pick<Job, 'status' | 'result'>): DomainLimitNotice | null {
  const result = job.result;
  if (!result) return null;
  if (job.status === 'failed' && result.error_code === DOMAIN_LIMIT_EXCEEDED) {
    const message = result.errors?.[0];
    return message ? { kind: 'failed', message } : null;
  }
  if (job.status === 'completed') {
    const message = result.warnings?.find((warning) => warning.includes(OVER_THE_LIMIT_WORDING));
    return message ? { kind: 'warning', message } : null;
  }
  return null;
}
