import type { ApiError } from '../api/errors';
import { buildRefusal } from '../api/jobs';
import type { Job, JobType, ListFormat } from '../types';
import { durationBetween, formatDateTime, formatDuration, parseApiDate } from './format';
import { sentence } from './text';

export const DEFAULT_LISTS_USERNAME = '__default__';

export function isDefaultListsBuild(job: Pick<Job, 'username' | 'user_id'>): boolean {
  return job.user_id === null || job.username === DEFAULT_LISTS_USERNAME;
}

export function attemptStartedAt(job: Job): string | null {
  return job.attempt_started_at ?? job.started_at ?? null;
}

export function attemptSeconds(job: Job, now: Date): number | null {
  if (job.status === 'queued') return null;
  const started = attemptStartedAt(job);
  if (!started) return null;
  return durationBetween(started, job.completed_at ?? now);
}

function previousCompleted(jobs: Job[], job: Job): Job | null {
  const index = jobs.findIndex((candidate) => candidate.job_id === job.job_id);
  if (index === -1) return null;
  return jobs.slice(index + 1).find((candidate) => candidate.status === 'completed') ?? null;
}

export function domainsAfter(jobs: Job[], job: Job): number | null {
  if (job.status === 'completed') return job.result?.unique_domains ?? null;
  if (job.status === 'skipped') return previousCompleted(jobs, job)?.result?.unique_domains ?? null;
  return null;
}

export function domainChange(jobs: Job[], job: Job): number | null {
  if (job.status === 'skipped') return 0;
  if (job.status !== 'completed' || !job.result) return null;
  const before = previousCompleted(jobs, job)?.result?.unique_domains;
  return before === undefined ? null : job.result.unique_domains - before;
}

export function compressedSize(
  job: Job | null,
  listName: string,
  format: ListFormat,
): number | null {
  const file = job?.result?.output_files.find(
    (candidate) => candidate.format === format && candidate.name === `${listName}_${format}.txt.gz`,
  );
  return file ? file.size_bytes : null;
}

export function sourceProblemCause(report: string | null | undefined): string {
  const text = (report ?? '').trim();
  if (!text) return '';
  const bracketed = /\(([^)]+)\)/.exec(text);
  return sentence(bracketed ? bracketed[1] : text.split(';')[0]);
}

const MS_PER_SECOND = 1000;

export function cooldownEndsAt(error: ApiError, refusedAt: number): number | null {
  const refusal = buildRefusal(error);
  if (refusal?.code !== 'cooldown') return null;
  const seconds = refusal.cooldown_remaining;
  return typeof seconds === 'number' && seconds > 0 ? refusedAt + seconds * MS_PER_SECOND : null;
}

export function cooldownSecondsLeft(endsAt: number | null, now: number): number {
  if (endsAt === null) return 0;
  return Math.max(0, Math.ceil((endsAt - now) / MS_PER_SECOND));
}

export function describeBuildWait(secondsLeft: number): string | null {
  return secondsLeft > 0
    ? `A build finished recently. You can start another in ${formatDuration(secondsLeft)}.`
    : null;
}

export function buildNowLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Build in ${formatDuration(secondsLeft)}` : 'Build now';
}

export function buildRefusalTitle(error: ApiError, saved: boolean): string {
  const waiting = buildRefusal(error)?.code === 'cooldown';
  if (saved) {
    return waiting
      ? 'Your changes were saved, but the build could not start yet'
      : 'Saved, but the build was not started';
  }
  return waiting ? 'The build could not start yet' : 'The build was not started';
}

export function describeBuildRefusal(error: ApiError, now: Date = new Date()): string {
  const refusal = buildRefusal(error);
  if (!refusal) {
    return error.kind === 'http'
      ? 'The build could not be started. Try again in a moment.'
      : `${error.message} The build was not started.`;
  }
  switch (refusal.code) {
    case 'cooldown':
      return (
        describeBuildWait(
          typeof refusal.cooldown_remaining === 'number' ? refusal.cooldown_remaining : 0,
        ) ?? sentence(refusal.error)
      );
    case 'weekly_limit': {
      const resets = parseApiDate(refusal.resets_at);
      return resets
        ? `You have used all of this week's manual builds. More on ${formatDateTime(resets, { now })}.`
        : sentence(refusal.error);
    }
    case 'build_active':
      return 'A build is already running, so a new one was not started.';
    case 'no_config':
      return 'There are no saved sources to build from yet. Add one on the Configuration page first.';
    case 'invalid_config': {
      const problems = (refusal.errors ?? []).slice(0, 3).join('; ');
      return `Your saved sources have a problem, so the build was not started${problems ? `: ${problems}` : ''}. Fix it on the Configuration page, then build again.`;
    }
    default:
      return sentence(refusal.error);
  }
}

export function runningBuildId(error: ApiError): string | null {
  const refusal = buildRefusal(error);
  return refusal?.code === 'build_active' ? (refusal.job_id ?? null) : null;
}

export const BUILD_TYPE_LABELS: Record<JobType, string> = {
  manual: 'Manual',
  scheduled: 'Scheduled',
  admin: 'Started by an admin',
};

export type BuildViewer = 'owner' | 'admin';

export function requestedBy(job: Pick<Job, 'type' | 'username'>, viewer: BuildViewer): string {
  if (job.type === 'manual' && viewer === 'admin' && job.username !== DEFAULT_LISTS_USERNAME) {
    return `Manual, by ${job.username}`;
  }
  return BUILD_TYPE_LABELS[job.type] ?? job.type;
}

export function isUnreadFailure(job: Pick<Job, 'status' | 'read'>): boolean {
  return job.status === 'failed' && job.read === false;
}

const NOTHING_PUBLISHED = /nothing was published/i;

export function statesNothingPublished(message: string | null | undefined): boolean {
  return NOTHING_PUBLISHED.test(message ?? '');
}
