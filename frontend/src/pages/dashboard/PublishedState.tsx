import type { ReactNode } from 'react';
import type { UserListsResponse } from '../../api/lists';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import type { IconName } from '../../components/ui/icons';
import { Skeleton } from '../../components/ui/Layout';
import { StatusPill } from '../../components/ui/StatusPill';
import type { StatusTone } from '../../components/ui/status';
import { cn } from '../../lib/cn';
import {
  formatDateTime,
  formatInteger,
  formatRelativeTime,
  formatSignedChange,
  pluralise,
} from '../../lib/format';
import type { Job } from '../../types';
import { domainChange } from '../../lib/builds';
import {
  describeAttention,
  describeLastFailure,
  describeManualBuilds,
  lastFinishedJob,
  lastCheckFoundChanges,
  publishedJob,
  sourceSummary,
  type PublicationState,
} from './dashboardFacts';

interface Headline {
  tone: StatusTone;
  icon: IconName;
  spin?: boolean;
  pill: string;
  title: string;
}

const HEADLINES: Record<PublicationState, Headline> = {
  'no-config': {
    tone: 'neutral',
    icon: 'sliders',
    pill: 'Not set up',
    title: 'Choose your sources to get started',
  },
  'never-built': {
    tone: 'neutral',
    icon: 'clock',
    pill: 'Not built yet',
    title: 'Your list has not been built yet',
  },
  building: {
    tone: 'info',
    icon: 'loop',
    spin: true,
    pill: 'Building',
    title: 'A build is running',
  },
  published: {
    tone: 'ok',
    icon: 'check',
    pill: 'Published',
    title: 'Your list is published and up to date',
  },
  'published-last-failed': {
    tone: 'warn',
    icon: 'warn',
    pill: 'Published',
    title: 'Your list is published, but the last build failed',
  },
};

function Fact({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="border-r border-border px-[22px] py-3.5 last:border-r-0 compact:border-b compact:nth-[2n]:border-r-0 compact:nth-last-[-n+2]:border-b-0">
      <span className="text-xs text-text-tertiary">{label}</span>
      <b className="num mt-0.5 block font-medium">{value}</b>
      {detail ? <small className="text-xs text-text-tertiary">{detail}</small> : null}
    </div>
  );
}

export interface PublishedStateProps {
  state: PublicationState;
  lists: UserListsResponse;
  jobs: Job[];
  configSourceCount: number;
  isAdmin: boolean;
  now: Date;
}

function summarySentence({
  state,
  lists,
  jobs,
  configSourceCount,
}: Pick<PublishedStateProps, 'state' | 'lists' | 'jobs' | 'configSourceCount'>): string {
  if (state === 'no-config') {
    return 'Pick blocklists from the library or start from the default template. Once your sources are saved you can run your first build.';
  }
  if (state === 'never-built') {
    return `You have ${pluralise(configSourceCount, 'source')} saved. Start a build to publish your list.`;
  }
  const published = publishedJob(jobs, lists.generation_id);
  const sources = published?.progress.sources ?? [];
  const total = formatInteger(lists.stats.total_domains);
  const from = sources.length > 0 ? ` from ${pluralise(sources.length, 'source')}` : '';
  const sentences = [`${total} domains${from}.`];
  if (state === 'building') {
    sentences.push(
      lists.lists.length > 0
        ? 'Your current list stays published until the build finishes.'
        : 'Your list is published when the build finishes.',
    );
  }
  if (state === 'published-last-failed') {
    const failed = lastFinishedJob(jobs);
    sentences.push(describeLastFailure(failed?.result?.errors[0]));
  }
  const attention = describeAttention(sourceSummary(sources));
  if (attention && state !== 'published-last-failed') sentences.push(attention);
  return lists.lists.length > 0 ? sentences.join(' ') : sentences.slice(1).join(' ');
}

export function PublishedState(props: PublishedStateProps) {
  const { state, lists, jobs, isAdmin, now } = props;
  const headline = HEADLINES[state];
  const nextRebuild = lists.next_rebuild_at;
  const published = publishedJob(jobs, lists.generation_id);
  const checkFoundChanges = lastCheckFoundChanges(jobs, lists.last_checked_at);
  const change = published ? domainChange(jobs, published) : null;
  const isPublished = lists.lists.length > 0;
  return (
    <Card as="section" aria-labelledby="publication-state">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-5 p-[22px] narrow:grid-cols-[minmax(0,1fr)]">
        <div>
          <StatusPill tone={headline.tone} icon={headline.icon} spin={headline.spin}>
            {headline.pill}
          </StatusPill>
          <h2
            id="publication-state"
            className="mt-2.5 mb-1 text-xl font-semibold tracking-[-0.01em]"
          >
            {headline.title}
          </h2>
          <p className="max-w-[62ch] text-text-secondary">{summarySentence(props)}</p>
        </div>
        <div className="grid justify-items-end gap-2 text-right narrow:justify-items-stretch narrow:text-left">
          {state === 'no-config' ? (
            <Button to="/config" variant="primary" icon="sliders">
              Choose sources
            </Button>
          ) : (
            <>
              <StatusPill icon="clock" className="narrow:justify-self-start">
                Next rebuild {formatRelativeTime(nextRebuild, now)}
              </StatusPill>
              <small className="text-xs text-text-tertiary">
                {describeManualBuilds(
                  lists.remaining_updates,
                  lists.limits.manual_updates_per_week,
                  isAdmin,
                  now,
                )}
              </small>
            </>
          )}
        </div>
      </div>
      {state === 'no-config' ? null : (
        <div className="grid grid-cols-4 border-t border-border compact:grid-cols-2">
          <Fact
            label="Published"
            value={isPublished ? formatDateTime(lists.published_at, { now }) : 'Not yet'}
            detail={
              isPublished ? formatRelativeTime(lists.published_at, now) : 'No build has finished'
            }
          />
          <Fact
            label="Sources last checked"
            value={
              lists.last_checked_at ? formatDateTime(lists.last_checked_at, { now }) : 'Not yet'
            }
            detail={
              checkFoundChanges === null
                ? null
                : checkFoundChanges
                  ? 'A new version was published'
                  : 'Nothing had changed'
            }
          />
          <Fact
            label="Last content change"
            value={isPublished ? formatDateTime(lists.published_at, { now }) : 'Not yet'}
            detail={
              change === null || change === 0 ? null : (
                <span className={cn(change > 0 && 'text-ok', change < 0 && 'text-fail')}>
                  {formatSignedChange(change)} domains
                </span>
              )
            }
          />
          <Fact
            label="Next rebuild"
            value={formatDateTime(nextRebuild, { now })}
            detail="Every Sunday"
          />
        </div>
      )}
    </Card>
  );
}

export function PublishedStateSkeleton() {
  return (
    <Card>
      <div className="grid gap-3 p-[22px]">
        <Skeleton className="h-[22px] w-24" />
        <Skeleton className="h-6 w-80 max-w-full" />
        <Skeleton className="h-4 w-[30rem] max-w-full" />
      </div>
      <div className="grid grid-cols-4 border-t border-border compact:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="grid gap-2 px-[22px] py-3.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-28" />
          </div>
        ))}
      </div>
    </Card>
  );
}
