import type { UserListsResponse } from '../../api/lists';
import { sourceOutcome } from '../../components/ui/status';
import { sourceProblemCause, statesNothingPublished } from '../../lib/builds';
import { formatDateTime } from '../../lib/format';
import { ADULT_CONTENT_LIST, COMBINED_LIST } from '../../lib/listCatalogue';
import { isActive } from '../../realtime/jobMerge';
import type { Job, LimitReview, SourceProgress, UserList } from '../../types';

export const RECENT_BUILDS_SHOWN = 5;

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

export function lastCheckFoundChanges(jobs: Job[], lastCheckedAt: string | null): boolean | null {
  if (!lastCheckedAt) return null;
  const check = jobs.find(
    (job) =>
      (job.status === 'completed' || job.status === 'skipped') &&
      job.completed_at === lastCheckedAt,
  );
  return check ? check.status === 'completed' : null;
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
  const leftOut = listCount(lists.lists, ADULT_CONTENT_LIST);
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

export function attentionItems(sources: SourceProgress[]): AttentionItem[] {
  return sources.flatMap((source): AttentionItem[] => {
    const outcome = sourceOutcome(source);
    const reason = sourceProblemCause(source.error ?? source.warnings[0]) || 'The download failed.';
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

export function categoryLists(lists: UserList[]): UserList[] {
  return lists.filter((list) => list.name !== COMBINED_LIST);
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

export function describeLastFailure(report: string | null | undefined): string {
  const cause = sourceProblemCause(report) || 'The last build failed.';
  return statesNothingPublished(cause)
    ? cause
    : `${cause} Your earlier list is still being served.`;
}
