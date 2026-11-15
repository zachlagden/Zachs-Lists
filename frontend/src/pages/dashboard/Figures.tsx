import type { UseQueryResult } from '@tanstack/react-query';
import type { UserListsResponse } from '../../api/lists';
import { Card } from '../../components/ui/Card';
import { Skeleton, StatCard } from '../../components/ui/Layout';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { formatBytes, formatInteger, formatPercent, pluralise } from '../../lib/format';
import type { AnalyticsReport, Job, LimitReview } from '../../types';
import { describeSourceSummary, domainUsage, publishedJob, sourceSummary } from './dashboardFacts';

export interface FiguresProps {
  lists: UserListsResponse;
  jobs: Job[];
  review: LimitReview | null;
  configSourceCount: number;
  isAdmin: boolean;
  analytics: Pick<UseQueryResult<AnalyticsReport>, 'data' | 'isPending' | 'isError'>;
}

export function Figures({
  lists,
  jobs,
  review,
  configSourceCount,
  isAdmin,
  analytics,
}: FiguresProps) {
  const usage = domainUsage(lists, review, jobs);
  const published = publishedJob(jobs, lists.generation_id);
  const sources = published?.progress.sources ?? [];
  const summary = sourceSummary(sources);
  const percent = formatPercent(usage.ratio);
  const about = usage.exact ? '' : 'about ';
  const patterns = published?.progress.whitelist?.patterns_total;
  return (
    <section aria-label="Figures" className="grid grid-cols-4 gap-4 compact:grid-cols-2">
      <StatCard
        label="Unique domains"
        value={`${usage.exact ? '' : '~'}${formatInteger(usage.domains)}`}
        detail={
          isAdmin
            ? 'Across all categories. Admin accounts have no limit'
            : `${about}${percent} of your ${formatInteger(usage.limit)} limit, across all categories`
        }
      >
        {isAdmin ? null : (
          <ProgressBar
            value={usage.ratio * 100}
            label="Domain limit used"
            valueText={`${about}${percent} of your limit used`}
          />
        )}
      </StatCard>
      <StatCard
        label="Sources"
        value={formatInteger(sources.length > 0 ? sources.length : configSourceCount)}
        detail={sources.length > 0 ? describeSourceSummary(summary) : 'Saved, not built yet'}
      />
      <StatCard
        label="Removed by whitelist"
        value={formatInteger(published?.result?.whitelisted_removed ?? 0)}
        detail={
          typeof patterns === 'number' ? pluralise(patterns, 'pattern') : 'In the published build'
        }
      />
      {analytics.isPending ? (
        <FigureSkeleton />
      ) : (
        <StatCard
          label="Downloads, 30 days"
          value={analytics.data ? formatInteger(analytics.data.totals.requests) : 'Unavailable'}
          detail={
            analytics.data
              ? `${formatBytes(analytics.data.totals.bandwidth_bytes)} served`
              : 'Download figures could not be loaded. Reload the page to try again'
          }
        />
      )}
    </section>
  );
}

function FigureSkeleton() {
  return (
    <Card className="grid gap-2.5 px-[18px] py-4">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-36" />
    </Card>
  );
}

export function FiguresSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-4 compact:grid-cols-2">
      {[0, 1, 2, 3].map((index) => (
        <FigureSkeleton key={index} />
      ))}
    </div>
  );
}
