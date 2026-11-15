import { useQuery } from '@tanstack/react-query';
import { userAnalyticsQuery } from '../../api/analytics';
import { jobsQuery } from '../../api/jobs';
import { userListsQuery } from '../../api/lists';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { LoadingRegion, PageHeader, Stack } from '../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';
import { useNow } from '../../lib/useNow';
import { useAuthStore } from '../../store';
import { publishedJob } from '../dashboard/dashboardFacts';
import { describeDownloads } from './listsFacts';
import { PublishedLists, PublishedListsSkeleton } from './PublishedLists';

export default function ListsPage() {
  useDocumentMeta('My lists');
  const user = useAuthStore((state) => state.user);
  const now = useNow();
  const lists = useQuery(userListsQuery());
  const jobs = useQuery(jobsQuery());
  const analytics = useQuery(userAnalyticsQuery());

  if (!user) return null;

  const hasLists = (lists.data?.lists.length ?? 0) > 0;

  return (
    <>
      <PageHeader
        title="My lists"
        description="The lists your last build published, and the address of each one."
        actions={
          <Button to="/config" icon="sliders">
            Edit sources
          </Button>
        }
      />
      <Stack>
        {lists.data && hasLists ? (
          <>
            <PublishedLists
              username={user.username}
              lists={lists.data}
              publishedBuild={publishedJob(jobs.data?.jobs ?? [], lists.data.generation_id)}
              now={now}
            />
            <p className="max-w-[78ch] text-[13px] text-text-secondary">
              Every published list is public. Anyone who has an address can download the list, and
              the address stays the same after each rebuild.{' '}
              {analytics.data
                ? describeDownloads(analytics.data.totals, analytics.data.period_days)
                : analytics.isError
                  ? 'The download figures could not be loaded.'
                  : ''}
            </p>
          </>
        ) : lists.data ? (
          <Card>
            <EmptyState
              title="No lists published yet"
              headingLevel="h2"
              icon="list"
              action={
                <Button to="/config" variant="primary" icon="sliders">
                  Choose sources
                </Button>
              }
            >
              Your lists and their addresses appear here when your first build finishes. Choose your
              sources on the Configuration page, then start a build from the dashboard.
            </EmptyState>
          </Card>
        ) : lists.isPending ? (
          <LoadingRegion label="Loading your lists…">
            <PublishedListsSkeleton />
          </LoadingRegion>
        ) : (
          <Card>
            <ErrorState
              title="Your lists could not be loaded"
              headingLevel="h2"
              error={lists.error}
              onRetry={() => void lists.refetch()}
              retrying={lists.isFetching}
            />
          </Card>
        )}
      </Stack>
    </>
  );
}
