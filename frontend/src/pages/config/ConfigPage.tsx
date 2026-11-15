import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { limitRequestsQuery } from '../../api/account';
import { categoriesQuery, configQuery, whitelistQuery } from '../../api/config';
import { jobsQuery } from '../../api/jobs';
import { userListsQuery } from '../../api/lists';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { LoadingRegion, PageHeader, Skeleton, Stack } from '../../components/ui/Layout';
import { ErrorState } from '../../components/ui/States';
import { useAuthStore } from '../../store';
import type { Job } from '../../types';
import { ConfigEditor } from './ConfigEditor';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

const NO_JOBS: Job[] = [];

function EditorSkeleton() {
  return (
    <LoadingRegion
      label="Loading your configuration…"
      className="grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] items-start gap-4 compact:grid-cols-[minmax(0,1fr)]"
    >
      <Card>
        <CardHeader title={<Skeleton className="h-5 w-24" />} />
        <CardBody className="grid gap-4">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </CardBody>
      </Card>
      <Stack>
        <Card>
          <CardHeader title={<Skeleton className="h-5 w-16" />} />
          <CardBody className="grid gap-4">
            <Skeleton className="h-6" />
            <Skeleton className="h-6" />
          </CardBody>
        </Card>
      </Stack>
    </LoadingRegion>
  );
}

export default function ConfigPage() {
  useDocumentMeta('Configuration');
  const user = useAuthStore((state) => state.user);
  const config = useQuery(configQuery());
  const whitelist = useQuery(whitelistQuery());
  const categories = useQuery(categoriesQuery());
  const lists = useQuery(userListsQuery());
  const jobs = useQuery(jobsQuery());
  const limitRequests = useQuery(limitRequestsQuery());

  const server = useMemo(
    () =>
      config.data && whitelist.data
        ? {
            sources: config.data.config,
            whitelist: whitelist.data.whitelist,
            revision: config.data.revision,
          }
        : null,
    [config.data, whitelist.data],
  );

  if (!user) return null;

  if (server && categories.data) {
    return (
      <ConfigEditor
        key={user.id}
        user={user}
        server={server}
        categories={categories.data.categories}
        lists={lists.data}
        jobs={jobs.data?.jobs ?? NO_JOBS}
        limitRequests={limitRequests.data}
      />
    );
  }

  const error = config.error ?? whitelist.error ?? categories.error;
  return (
    <>
      <PageHeader
        title="Configuration"
        description="Choose the lists to combine and the domains to keep out of the result."
      />
      {error ? (
        <Card>
          <ErrorState
            title="Your configuration could not be loaded"
            headingLevel="h2"
            error={error}
            onRetry={() => {
              void config.refetch();
              void whitelist.refetch();
              void categories.refetch();
            }}
            retrying={config.isFetching || whitelist.isFetching || categories.isFetching}
          />
        </Card>
      ) : (
        <EditorSkeleton />
      )}
    </>
  );
}
