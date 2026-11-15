import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { adminUserJobsQuery, type AdminUserDetail } from '../../../../api/admin';
import { Button } from '../../../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../../../components/ui/Card';
import { KeyValueList, LoadingRegion } from '../../../../components/ui/Layout';
import { StatusPill } from '../../../../components/ui/StatusPill';
import { EmptyState, ErrorState } from '../../../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../../components/ui/Table';
import { formatDateTime, formatInteger, formatPercent } from '../../../../lib/format';
import { BuildsTable, BuildsTableSkeleton } from '../../builds/BuildsTable';
import { methodLabel } from '../../limits/limitFacts';
import { ResolveReviewDialog } from '../../limits/ResolveReviewDialog';
import { Pagination } from '../../shared/Pagination';

export function ReviewCard({ user, now }: { user: AdminUserDetail; now: Date }) {
  const [resolving, setResolving] = useState(false);
  const review = user.limit_review?.status === 'open' ? user.limit_review : null;
  if (!review) return null;
  const over = review.max_domains > 0 ? review.actual_domains / review.max_domains - 1 : 0;
  return (
    <Card as="section" aria-labelledby="user-review">
      <CardHeader
        title="Open domain limit review"
        titleId="user-review"
        actions={
          <StatusPill tone="warn" icon="warn">
            Over the limit
          </StatusPill>
        }
      />
      <CardBody className="grid gap-4">
        <KeyValueList
          items={[
            { label: 'Measured', value: `${formatInteger(review.actual_domains)} domains` },
            { label: 'Limit when measured', value: formatInteger(review.max_domains) },
            { label: 'Over by', value: formatPercent(over) },
            { label: 'How it was measured', value: methodLabel(review.method) },
            { label: 'Detected', value: formatDateTime(review.detected_at, { now }) || 'Unknown' },
            {
              label: 'Account notified',
              value: review.notified_at ? formatDateTime(review.notified_at, { now }) : 'Not yet',
            },
          ]}
        />
        <div>
          <Button size="sm" onClick={() => setResolving(true)}>
            Resolve the review
          </Button>
        </div>
      </CardBody>
      {resolving ? (
        <ResolveReviewDialog
          review={{
            user_id: user.id,
            username: user.username,
            actual_domains: review.actual_domains,
            max_domains: review.max_domains,
          }}
          onClose={() => setResolving(false)}
        />
      ) : null}
    </Card>
  );
}

export function UserBuilds({ user, now }: { user: AdminUserDetail; now: Date }) {
  const [page, setPage] = useState(1);
  const builds = useQuery(adminUserJobsQuery(user.id, page));
  return (
    <Card as="section" aria-labelledby="user-builds">
      <CardHeader title="Builds" titleId="user-builds" />
      {builds.data ? (
        builds.data.total === 0 ? (
          <EmptyState title="No builds for this account">
            Builds appear here once the account starts one or the weekly rebuild runs. Finished
            builds are deleted after 30 days.
          </EmptyState>
        ) : (
          <div aria-busy={builds.isPlaceholderData || undefined}>
            <BuildsTable
              jobs={builds.data.jobs}
              now={now}
              caption={`Builds for ${user.username}, newest first`}
              showOwner={false}
            />
            {builds.data.pages > 1 ? (
              <Pagination
                label={`Pages of builds for ${user.username}`}
                page={builds.data.page}
                pages={builds.data.pages}
                perPage={builds.data.per_page}
                total={builds.data.total}
                noun="builds"
                onPageChange={setPage}
              />
            ) : null}
          </div>
        )
      ) : builds.isError ? (
        <ErrorState
          title="Builds could not be loaded"
          error={builds.error}
          onRetry={() => void builds.refetch()}
          retrying={builds.isFetching}
        />
      ) : (
        <LoadingRegion label="Loading builds…">
          <BuildsTableSkeleton />
        </LoadingRegion>
      )}
    </Card>
  );
}

export function IpLogCard({ user, now }: { user: AdminUserDetail; now: Date }) {
  return (
    <Card as="section" aria-labelledby="user-ip-log">
      <CardHeader title="Address log" titleId="user-ip-log" />
      <p className="border-b border-border px-[18px] py-2.5 text-[13px] text-text-secondary narrow:px-3">
        Addresses are stored only as one-way hashes. Two rows with the same hash came from the same
        address; the address itself cannot be recovered.
      </p>
      {user.ip_log.length === 0 ? (
        <EmptyState title="Nothing recorded">
          An entry is added when the account is used from an address.
        </EmptyState>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Address hash</TableHeaderCell>
              <TableHeaderCell hideOnNarrow>First seen</TableHeaderCell>
              <TableHeaderCell>Last seen</TableHeaderCell>
              <TableHeaderCell align="right">Times seen</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {user.ip_log.map((entry, index) => (
              <TableRow key={`${entry.ip_hash ?? 'none'}-${index}`}>
                <TableCell className="font-mono text-[13px] break-all">
                  {entry.ip_hash ?? 'Not recorded'}
                </TableCell>
                <TableCell hideOnNarrow className="whitespace-nowrap text-text-secondary">
                  {formatDateTime(entry.first_seen, { now }) || 'Unknown'}
                </TableCell>
                <TableCell className="whitespace-nowrap text-text-secondary">
                  {formatDateTime(entry.last_seen, { now }) || 'Unknown'}
                </TableCell>
                <TableCell align="right">{formatInteger(entry.access_count)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
