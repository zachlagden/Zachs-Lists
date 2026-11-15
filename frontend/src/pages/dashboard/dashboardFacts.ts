import type { ApiError } from '../../api/errors';
import { buildRefusal } from '../../api/jobs';
import type { UserListsResponse } from '../../api/lists';
import { sourceOutcome } from '../../components/ui/status';
import { durationBetween, formatDateTime, formatDuration, parseApiDate } from '../../lib/format';
import { isActive } from '../../realtime/jobMerge';
import type { Job, LimitReview, ListFormat, SourceProgress, UserList } from '../../types';

export const COMBINED_LIST = 'all_domains';
export const CATEGORY_LEFT_OUT_OF_COMBINED_LIST = 'nsfw';
export const RECENT_BUILDS_SHOWN = 5;

const USER_REBUILD_WEEKDAY_UTC = 0;
const USER_REBUILD_HOUR_UTC = 7;
const USER_REBUILD_MINUTE_UTC = 30;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function nextScheduledRebuild(now: Date): Date {
  const candidate = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      USER_REBUILD_HOUR_UTC,
      USER_REBUILD_MINUTE_UTC,
    ),
  );
  const daysAhead = (USER_REBUILD_WEEKDAY_UTC - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
  if (candidate.getTime() <= now.getTime()) candidate.setTime(candidate.getTime() + WEEK_MS);
  return candidate;
}

export function nextManualBuildReset(now: Date): Date {
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const daysAhead = 7 - midnight.getUTCDay();
  midnight.setUTCDate(midnight.getUTCDate() + daysAhead);
  return midnight;
}

export function activeJob(jobs: Job[]): Job | null {
  return jobs.find(isActive) ?? null;
}

export function publishedJob(jobs: Job[], generationId: string | null | undefined): Job | null {
  if (!generationId) return null;
  return (
    jobs.find((job) => job.status === 'completed' && job.result?.generation_id === generationId) ??
    null
  );
}

export function lastFinishedJob(jobs: Job[]): Job | null {
  return jobs.find((job) => !isActive(job)) ?? null;
}

export interface SourceCheck {
  at: string;
  changed: boolean;
}

export function lastSourceCheck(jobs: Job[]): SourceCheck | null {
  const job = jobs.find(
    (candidate) =>
      (candidate.status === 'completed' || candidate.status === 'skipped') &&
      candidate.completed_at,
  );
  if (!job?.completed_at) return null;
  return { at: job.completed_at, changed: job.status === 'completed' };
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

export function buildDurationSeconds(job: Job, now: Date): number | null {
  const started = job.started_at ?? job.attempt_started_at;
  if (!started) return null;
  return durationBetween(started, job.completed_at ?? now);
}

export type PublicationState =
  | 'no-config'
  | 'never-built'
  | 'building'
  | 'published'
  | 'published-last-failed';

export function publicationState(
  hasConfig: boolean,
  lists: Pick<UserListsResponse, 'lists' | 'published_at'>,
  jobs: Job[],
): PublicationState {
  const isPublished = lists.lists.length > 0;
  if (activeJob(jobs)) return isPublished || hasConfig ? 'building' : 'no-config';
  if (!isPublished) return hasConfig ? 'never-built' : 'no-config';
  return lastFinishedJob(jobs)?.status === 'failed' ? 'published-last-failed' : 'published';
}

export interface DomainUsage {
  domains: number;
  exact: boolean;
  limit: number;
  ratio: number;
  over: boolean;
}

function listCount(lists: UserList[], name: string): number {
  return lists.find((list) => list.name === name)?.domain_count ?? 0;
}

export function domainUsage(
  lists: Pick<UserListsResponse, 'lists' | 'limits' | 'generation_id' | 'stats'>,
  review: LimitReview | null,
  jobs: Job[],
): DomainUsage {
  const limit = lists.limits.max_domains;
  const measured = publishedJob(jobs, lists.generation_id)?.result?.limit?.actual_domains;
  const leftOut = listCount(lists.lists, CATEGORY_LEFT_OUT_OF_COMBINED_LIST);
  const combined = listCount(lists.lists, COMBINED_LIST) || lists.stats.total_domains;
  let domains = combined + leftOut;
  let exact = leftOut === 0;
  if (typeof measured === 'number') {
    domains = measured;
    exact = true;
  } else if (review?.status === 'open') {
    domains = review.actual_domains;
    exact = review.method !== 'stored';
  }
  return {
    domains,
    exact,
    limit,
    ratio: limit > 0 ? domains / limit : 0,
    over: limit > 0 && domains > limit,
  };
}

export interface SourceSummary {
  total: number;
  current: number;
  stale: number;
  failed: number;
}

export function sourceSummary(sources: SourceProgress[]): SourceSummary {
  const summary: SourceSummary = { total: sources.length, current: 0, stale: 0, failed: 0 };
  for (const source of sources) {
    const outcome = sourceOutcome(source);
    if (outcome === 'failed') summary.failed += 1;
    else if (outcome === 'stale') summary.stale += 1;
    else if (outcome === 'current' || outcome === 'cached') summary.current += 1;
  }
  return summary;
}

export function describeSourceSummary(summary: SourceSummary): string {
  const parts = [`${summary.current} current`];
  if (summary.stale > 0) {
    parts.push(`${summary.stale} older ${summary.stale === 1 ? 'copy' : 'copies'}`);
  }
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  return parts.join(' · ');
}

export interface AttentionItem {
  id: string;
  name: string;
  kind: 'stale' | 'failed';
  detail: string;
}

function sentence(text: string | null): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

export function sourceFailureCause(report: string | null | undefined): string {
  const text = (report ?? '').trim();
  if (!text) return 'The download failed.';
  const bracketed = /\(([^)]+)\)/.exec(text);
  return sentence(bracketed ? bracketed[1] : text.split(';')[0]);
}

export function attentionItems(sources: SourceProgress[]): AttentionItem[] {
  return sources.flatMap((source): AttentionItem[] => {
    const outcome = sourceOutcome(source);
    const reason = sourceFailureCause(source.error ?? source.warnings[0]);
    if (outcome === 'failed') {
      return [
        {
          id: source.id,
          name: source.name,
          kind: 'failed',
          detail: `${reason} No usable earlier copy exists, so it was left out.`,
        },
      ];
    }
    if (outcome === 'stale') {
      return [
        {
          id: source.id,
          name: source.name,
          kind: 'stale',
          detail: `${reason} The build used an older copy.`,
        },
      ];
    }
    return [];
  });
}

export function describeAttention(summary: SourceSummary): string {
  const count = summary.stale + summary.failed;
  if (count === 0) return '';
  const parts: string[] = [];
  if (summary.stale > 0) {
    parts.push(`${summary.stale === 1 ? 'one' : summary.stale} used an older copy`);
  }
  if (summary.failed > 0) {
    parts.push(
      `${summary.failed === 1 ? 'one' : summary.failed} ${summary.failed === 1 ? 'was' : 'were'} left out`,
    );
  }
  const subject = count === 1 ? 'One source needs attention' : `${count} sources need attention`;
  return `${subject}: ${parts.join(' and ')}.`;
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

export function categoryLists(lists: UserList[]): UserList[] {
  return lists.filter((list) => list.name !== COMBINED_LIST);
}

export function listAddress(
  siteUrl: string,
  username: string,
  name: string,
  format: ListFormat,
): string {
  return `${siteUrl}/u/${username}/${name}.txt?format=${format}`;
}

export function describeManualBuilds(
  remaining: number,
  perWeek: number,
  isAdmin: boolean,
  now: Date,
): string {
  if (isAdmin) return 'Admin builds do not count towards a weekly limit';
  if (remaining <= 0) {
    return `No manual builds left this week. More on ${formatDateTime(nextManualBuildReset(now), { now })}`;
  }
  return `${remaining} of ${perWeek} manual builds left this week`;
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
      return typeof refusal.cooldown_remaining === 'number'
        ? `A build finished recently. You can start another in ${formatDuration(refusal.cooldown_remaining)}.`
        : sentence(refusal.error);
    case 'weekly_limit': {
      const resets = parseApiDate(refusal.resets_at);
      return resets
        ? `You have used all of this week's manual builds. More on ${formatDateTime(resets, { now })}.`
        : sentence(refusal.error);
    }
    case 'build_active':
      return 'A build is already running. It appears under recent builds.';
    case 'no_config':
      return 'There are no sources to build from yet. Add some on the Configuration page first.';
    case 'invalid_config': {
      const problems = (refusal.errors ?? []).slice(0, 3).join('; ');
      return `Your sources have a problem, so the build was not started${problems ? `: ${problems}` : ''}. Fix it on the Configuration page, then build again.`;
    }
    default:
      return sentence(refusal.error);
  }
}
