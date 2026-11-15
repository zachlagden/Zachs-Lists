import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { adminUserQuery } from '../../../../api/admin';
import { toApiError } from '../../../../api/errors';
import { Button } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';
import { LoadingRegion, PageHeader, Skeleton, Stack } from '../../../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../../../components/ui/States';
import { useNow } from '../../../../lib/useNow';
import { useAuthStore } from '../../../../store';
import { canChangeAdminRole, canManageAccount } from '../../shared/permissions';
import { AccessCard } from './AccessCard';
import { LimitsCard } from './LimitsCard';
import { ProfileCard } from './ProfileCard';
import { IpLogCard, ReviewCard, UserBuilds } from './UserActivity';
import { useDocumentMeta } from '../../../../hooks/useDocumentMeta';
import { adminTitle } from '../../shared/sections';

const BACK = (
  <Button to="/admin/users" variant="ghost" size="sm" icon="arrow-left" className="-ml-2.5">
    All users
  </Button>
);

export default function UserDetailPage() {
  const { userId = '' } = useParams();
  const viewer = useAuthStore((state) => state.user);
  const now = useNow();
  const user = useQuery(adminUserQuery(userId));
  const missing = user.isError && toApiError(user.error).status === 404;
  useDocumentMeta(adminTitle(user.data?.username ?? (missing ? 'User not found' : 'User')));

  if (!viewer) return null;

  if (!user.data) {
    return (
      <>
        <PageHeader title={missing ? 'User not found' : 'User'} eyebrow={BACK} />
        <Card>
          {missing ? (
            <EmptyState
              title="This account does not exist"
              headingLevel="h2"
              action={
                <Button to="/admin/users" size="sm">
                  Back to all users
                </Button>
              }
            >
              It may have been deleted, or the address may be wrong.
            </EmptyState>
          ) : user.isError ? (
            <ErrorState
              title="The account could not be loaded"
              headingLevel="h2"
              error={user.error}
              onRetry={() => void user.refetch()}
              retrying={user.isFetching}
            />
          ) : (
            <LoadingRegion label="Loading the account…" className="grid gap-3 p-[18px]">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </LoadingRegion>
          )}
        </Card>
      </>
    );
  }

  const account = user.data;
  const manage = canManageAccount(viewer, account);
  const adminRole = canChangeAdminRole(viewer, account);

  return (
    <>
      <PageHeader
        title={account.username}
        eyebrow={BACK}
        description={account.name ?? account.email ?? undefined}
      />
      <Stack>
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-start gap-4 compact:grid-cols-[minmax(0,1fr)]">
          <ProfileCard user={account} now={now} />
          <AccessCard user={account} manage={manage} adminRole={adminRole} now={now} />
        </div>
        <LimitsCard key={account.id} user={account} permission={manage} />
        <ReviewCard user={account} now={now} />
        <UserBuilds user={account} now={now} />
        <IpLogCard user={account} now={now} />
      </Stack>
    </>
  );
}
