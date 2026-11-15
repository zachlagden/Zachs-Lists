import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ADMIN_LIMIT_REVIEWS_PAGE_SIZE,
  adminJobsQuery,
  adminLimitRequestsQuery,
  limitReviewsQuery,
} from '../../../api/admin';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader } from '../../../components/ui/Card';
import { LoadingRegion, Skeleton } from '../../../components/ui/Layout';
import { DescribedPill } from '../../../components/ui/StatusPill';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui/Table';
import { formatDateTime, formatInteger, pluralise } from '../../../lib/format';
import { INTENDED_USE_LABELS, type LimitRequest } from '../../../types';
import { USAGE_SOURCE_LABELS, orderRequests, requestStatus, requestUsage } from './limitFacts';
import { RequestDecisionDialog, type Decision } from './RequestDecisionDialog';
import { CELL_LINK } from '../../../components/ui/linkClasses';
import { cn } from '../../../lib/cn';

function DecisionCell({ request, now }: { request: LimitRequest; now: Date }) {
  const status = requestStatus(request.status);
  return (
    <div className="grid justify-items-start gap-1">
      <DescribedPill description={status} />
      {request.status === 'approved' && typeof request.approved_limit === 'number' ? (
        <span className="num text-xs text-text-secondary">
          Raised to {formatInteger(request.approved_limit)}
        </span>
      ) : null}
      {request.reviewed_by ? (
        <span className="text-xs text-text-tertiary">
          By {request.reviewed_by}, {formatDateTime(request.reviewed_at, { now })}
        </span>
      ) : null}
      {request.admin_response ? (
        <span className="max-w-[260px] text-xs break-words text-text-secondary">
          "{request.admin_response}"
        </span>
      ) : null}
    </div>
  );
}

export function RequestsCard({ now }: { now: Date }) {
  const requests = useQuery(adminLimitRequestsQuery());
  const reviews = useQuery(limitReviewsQuery(1, ADMIN_LIMIT_REVIEWS_PAGE_SIZE));
  const jobs = useQuery(adminJobsQuery());
  const [deciding, setDeciding] = useState<{ request: LimitRequest; decision: Decision } | null>(
    null,
  );
  const ordered = requests.data ? orderRequests(requests.data.requests) : [];

  return (
    <Card as="section" aria-labelledby="limit-requests">
      <CardHeader
        title="Limit requests"
        titleId="limit-requests"
        actions={
          requests.data ? (
            <span className="num">{pluralise(requests.data.pending_count, 'request')} waiting</span>
          ) : null
        }
      />
      {requests.data ? (
        ordered.length === 0 ? (
          <EmptyState title="No limit requests">
            A request appears here when an account asks for a higher domain limit.
          </EmptyState>
        ) : (
          <Table>
            <caption className="sr-only">Requests for a higher domain limit, waiting first</caption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Account</TableHeaderCell>
                <TableHeaderCell align="right">Asked for</TableHeaderCell>
                <TableHeaderCell align="right" hideOnNarrow>
                  Current use
                </TableHeaderCell>
                <TableHeaderCell hideOnNarrow>Reason</TableHeaderCell>
                <TableHeaderCell hideOnNarrow>Asked</TableHeaderCell>
                <TableHeaderCell>Decision</TableHeaderCell>
                <TableHeaderCell align="right" hideOnNarrow>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {ordered.map((request) => {
                const usage = requestUsage(
                  request,
                  reviews.data?.reviews ?? [],
                  jobs.data?.jobs ?? [],
                );
                const actions =
                  request.status === 'pending' ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => setDeciding({ request, decision: 'deny' })}
                        aria-label={`Deny the request from ${request.username}`}
                      >
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setDeciding({ request, decision: 'approve' })}
                        aria-label={`Approve the request from ${request.username}`}
                      >
                        Approve
                      </Button>
                    </>
                  ) : null;
                return (
                  <TableRow key={request.id}>
                    <TableCell className="align-top">
                      <Link
                        to={`/admin/users/${encodeURIComponent(request.user_id)}`}
                        className={cn(CELL_LINK, 'font-medium break-all')}
                      >
                        {request.username}
                      </Link>
                      <span className="block text-xs whitespace-nowrap text-text-tertiary">
                        {INTENDED_USE_LABELS[request.intended_use] ?? request.intended_use}
                      </span>
                      <span className="mt-1 hidden text-xs break-words text-text-secondary narrow:block">
                        {request.reason}
                      </span>
                    </TableCell>
                    <TableCell align="right" className="align-top">
                      {formatInteger(request.requested_tier)}
                      <span className="block text-xs whitespace-nowrap text-text-tertiary">
                        from {formatInteger(request.current_limit)}
                      </span>
                    </TableCell>
                    <TableCell align="right" hideOnNarrow className="align-top">
                      {formatInteger(usage.domains)}
                      <span className="ml-auto block max-w-[200px] text-xs font-normal text-text-tertiary">
                        {USAGE_SOURCE_LABELS[usage.source]}
                      </span>
                    </TableCell>
                    <TableCell hideOnNarrow className="align-top">
                      <p className="max-w-[320px] min-w-[180px] text-[13px] break-words text-text-secondary">
                        {request.reason}
                      </p>
                    </TableCell>
                    <TableCell
                      hideOnNarrow
                      className="align-top whitespace-nowrap text-text-secondary"
                    >
                      {formatDateTime(request.created_at, { now })}
                    </TableCell>
                    <TableCell className="align-top">
                      <DecisionCell request={request} now={now} />
                      <span className="mt-2 hidden flex-wrap gap-2 narrow:flex">{actions}</span>
                    </TableCell>
                    <TableCell align="right" hideOnNarrow className="align-top">
                      <span className="inline-flex justify-end gap-2">{actions}</span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )
      ) : requests.isError ? (
        <ErrorState
          title="Limit requests could not be loaded"
          error={requests.error}
          onRetry={() => void requests.refetch()}
          retrying={requests.isFetching}
        />
      ) : (
        <LoadingRegion label="Loading limit requests…" className="grid gap-3 p-[18px]">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </LoadingRegion>
      )}
      {deciding ? (
        <RequestDecisionDialog
          key={`${deciding.request.id}-${deciding.decision}`}
          request={deciding.request}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
        />
      ) : null}
    </Card>
  );
}
