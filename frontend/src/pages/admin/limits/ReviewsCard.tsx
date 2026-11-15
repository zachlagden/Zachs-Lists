import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ADMIN_LIMIT_REVIEWS_PAGE_SIZE, limitReviewsQuery } from '../../../api/admin';
import { Button } from '../../../components/ui/Button';
import { Card, CardHeader } from '../../../components/ui/Card';
import { LoadingRegion, Skeleton } from '../../../components/ui/Layout';
import { StatusPill } from '../../../components/ui/StatusPill';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui/Table';
import { formatDateTime, formatInteger } from '../../../lib/format';
import type { AdminLimitReview } from '../../../types';
import { Pagination } from '../shared/Pagination';
import { pageFromSearch } from '../shared/urlState';
import { useUrlState } from '../shared/useUrlState';
import { enforcementSentence, methodLabel, percentOverText, type Enforcement } from './limitFacts';
import { ResolveReviewDialog } from './ResolveReviewDialog';
import { CELL_LINK } from '../../../components/ui/linkClasses';
import { cn } from '../../../lib/cn';

const PAGE_KEY = 'reviews_page';

function YesNo({ yes, yesLabel, noLabel }: { yes: boolean; yesLabel: string; noLabel: string }) {
  return yes ? (
    <StatusPill tone="info" icon="tick">
      {yesLabel}
    </StatusPill>
  ) : (
    <StatusPill icon="dash">{noLabel}</StatusPill>
  );
}

export function ReviewsCard({ enforcement, now }: { enforcement: Enforcement; now: Date }) {
  const { params, update } = useUrlState();
  const page = pageFromSearch(params, PAGE_KEY);
  const reviews = useQuery(limitReviewsQuery(page, ADMIN_LIMIT_REVIEWS_PAGE_SIZE));
  const [resolving, setResolving] = useState<AdminLimitReview | null>(null);

  return (
    <Card as="section" aria-labelledby="limit-reviews">
      <CardHeader title="Over the domain limit" titleId="limit-reviews" />
      <p className="border-b border-border px-[18px] py-2.5 text-[13px] text-text-secondary narrow:px-3">
        {enforcementSentence(enforcement)}
      </p>
      {reviews.data ? (
        <div aria-busy={reviews.isPlaceholderData || undefined}>
          {reviews.data.reviews.length === 0 ? (
            <EmptyState title="No account is over its limit">
              An account is listed here when a build or an audit measures more domains than its
              limit allows.
            </EmptyState>
          ) : (
            <Table>
              <caption className="sr-only">Accounts over their domain limit</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Account</TableHeaderCell>
                  <TableHeaderCell align="right" hideOnNarrow>
                    Limit
                  </TableHeaderCell>
                  <TableHeaderCell align="right">Measured</TableHeaderCell>
                  <TableHeaderCell align="right">Over by</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>How it was measured</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Detected</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Notified</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Request</TableHeaderCell>
                  <TableHeaderCell align="right">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {reviews.data.reviews.map((review) => (
                  <TableRow key={review.user_id}>
                    <TableCell>
                      <Link
                        to={`/admin/users/${encodeURIComponent(review.user_id)}`}
                        className={cn(CELL_LINK, 'font-medium break-all')}
                      >
                        {review.username}
                      </Link>
                    </TableCell>
                    <TableCell align="right" hideOnNarrow>
                      {formatInteger(review.max_domains)}
                    </TableCell>
                    <TableCell align="right">{formatInteger(review.actual_domains)}</TableCell>
                    <TableCell align="right" className="whitespace-nowrap">
                      {percentOverText(review.percent_over)}
                    </TableCell>
                    <TableCell hideOnNarrow className="text-text-secondary">
                      {methodLabel(review.method)}
                    </TableCell>
                    <TableCell hideOnNarrow className="whitespace-nowrap text-text-secondary">
                      {formatDateTime(review.detected_at, { now }) || 'Unknown'}
                    </TableCell>
                    <TableCell hideOnNarrow>
                      <YesNo yes={review.notified} yesLabel="Notified" noLabel="Not yet" />
                    </TableCell>
                    <TableCell hideOnNarrow>
                      <YesNo yes={review.has_pending_request} yesLabel="Waiting" noLabel="None" />
                    </TableCell>
                    <TableCell align="right">
                      <Button
                        size="sm"
                        onClick={() => setResolving(review)}
                        aria-label={`Resolve the review for ${review.username}`}
                      >
                        Resolve
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {reviews.data.total > reviews.data.per_page || page > 1 ? (
            <Pagination
              label="Pages of accounts over the limit"
              page={reviews.data.page}
              pages={reviews.data.pages}
              perPage={reviews.data.per_page}
              total={reviews.data.total}
              noun="accounts"
              onPageChange={(next) => update({ [PAGE_KEY]: next === 1 ? null : next })}
            />
          ) : null}
        </div>
      ) : reviews.isError ? (
        <ErrorState
          title="Limit reviews could not be loaded"
          error={reviews.error}
          onRetry={() => void reviews.refetch()}
          retrying={reviews.isFetching}
        />
      ) : (
        <LoadingRegion label="Loading limit reviews…" className="grid gap-3 p-[18px]">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-full" />
        </LoadingRegion>
      )}
      {resolving ? (
        <ResolveReviewDialog review={resolving} onClose={() => setResolving(null)} />
      ) : null}
    </Card>
  );
}
