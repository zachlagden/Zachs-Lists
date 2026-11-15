import type { Job, JobStatus, SourceProgress } from '../../types';
import type { IconName } from './icons';

export type StatusTone = 'ok' | 'warn' | 'fail' | 'info' | 'neutral';

export interface StatusDescription {
  tone: StatusTone;
  icon: IconName;
  label: string;
  spin?: boolean;
}

const JOB_STATUS: Record<JobStatus, StatusDescription> = {
  queued: { tone: 'neutral', icon: 'clock', label: 'Queued' },
  processing: { tone: 'info', icon: 'loop', label: 'Building', spin: true },
  completed: { tone: 'ok', icon: 'check', label: 'Completed' },
  failed: { tone: 'fail', icon: 'fail', label: 'Failed' },
  skipped: { tone: 'neutral', icon: 'dash', label: 'Skipped' },
};

export function jobStatusDescription(status: Job['status']): StatusDescription {
  return JOB_STATUS[status] ?? { tone: 'neutral', icon: 'dash', label: status };
}

export type SourceOutcome =
  | 'pending'
  | 'downloading'
  | 'processing'
  | 'current'
  | 'cached'
  | 'stale'
  | 'failed';

const SOURCE_OUTCOME: Record<SourceOutcome, StatusDescription> = {
  pending: { tone: 'neutral', icon: 'clock', label: 'Waiting' },
  downloading: { tone: 'info', icon: 'loop', label: 'Downloading', spin: true },
  processing: { tone: 'info', icon: 'loop', label: 'Reading', spin: true },
  current: { tone: 'ok', icon: 'check', label: 'Downloaded' },
  cached: { tone: 'ok', icon: 'check', label: 'Unchanged' },
  stale: { tone: 'warn', icon: 'warn', label: 'Older copy' },
  failed: { tone: 'fail', icon: 'fail', label: 'Failed' },
};

export function sourceOutcome(
  source: Pick<SourceProgress, 'status' | 'stale' | 'cache_hit'>,
): SourceOutcome {
  if (source.status === 'failed') return 'failed';
  if (source.status === 'completed') {
    if (source.stale) return 'stale';
    return source.cache_hit ? 'cached' : 'current';
  }
  return source.status;
}

export function sourceStatusDescription(
  source: Pick<SourceProgress, 'status' | 'stale' | 'cache_hit'>,
): StatusDescription {
  return SOURCE_OUTCOME[sourceOutcome(source)];
}
