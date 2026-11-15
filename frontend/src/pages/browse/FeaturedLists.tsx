import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import type { FeaturedListSummary } from '../../api/lists';
import { ListRowsSkeleton } from '../../components/lists/DefaultListsTable';
import { FormatSwitch } from '../../components/lists/FormatSwitch';
import { ListActions } from '../../components/lists/ListActions';
import { Card, CardHeader } from '../../components/ui/Card';
import { LoadingRegion } from '../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../components/ui/Table';
import { SITE_URL } from '../../config/site';
import { formatDateTime } from '../../lib/format';
import {
  SERVER_DEFAULT_FORMAT,
  exactDomains,
  userListAddress,
  userListPath,
} from '../../lib/listCatalogue';
import { useNow } from '../../lib/useNow';
import type { ListFormat } from '../../types';

const NO_DESCRIPTION = 'No description';

function FeaturedTable({
  lists,
  format,
  now,
}: {
  lists: FeaturedListSummary[];
  format: ListFormat;
  now: Date;
}) {
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>List</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Description</TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Domains
          </TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Published
          </TableHeaderCell>
          <TableHeaderCell align="right">
            <span className="sr-only">Address</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {lists.map((list) => {
          const label = `${list.username}/${list.list_name}`;
          return (
            <TableRow key={list.id}>
              <TableCell>
                <b className="font-medium break-all" translate="no">
                  {label}
                </b>
                <span className="hidden text-[13px] break-words text-text-secondary narrow:block">
                  {list.description || NO_DESCRIPTION}
                </span>
                <span className="num hidden text-[13px] text-text-tertiary narrow:block">
                  {exactDomains(list.domain_count)} domains
                </span>
              </TableCell>
              <TableCell hideOnNarrow className="break-words text-text-secondary">
                {list.description || NO_DESCRIPTION}
              </TableCell>
              <TableCell align="right" hideOnNarrow className="whitespace-nowrap">
                {exactDomains(list.domain_count)}
              </TableCell>
              <TableCell
                align="right"
                hideOnNarrow
                className="whitespace-nowrap text-text-secondary"
              >
                {formatDateTime(list.last_updated, { now }) || 'Unknown'}
              </TableCell>
              <TableCell align="right">
                <ListActions
                  listLabel={label}
                  format={format}
                  available
                  address={userListAddress(SITE_URL, list.username, list.list_name, format)}
                  openPath={userListPath(list.username, list.list_name, format)}
                />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export interface FeaturedListsProps {
  query: Pick<
    UseQueryResult<FeaturedListSummary[]>,
    'data' | 'error' | 'isPending' | 'isFetching' | 'refetch'
  >;
}

export function FeaturedLists({ query }: FeaturedListsProps) {
  const [format, setFormat] = useState<ListFormat>(SERVER_DEFAULT_FORMAT);
  const now = useNow();
  return (
    <Card as="section" aria-labelledby="featured-lists">
      <CardHeader
        title="Featured community lists"
        titleId="featured-lists"
        actions={
          query.data && query.data.length > 0 ? (
            <FormatSwitch value={format} onChange={setFormat} label="Featured list format" />
          ) : null
        }
      />
      {query.data && query.data.length > 0 ? (
        <FeaturedTable lists={query.data} format={format} now={now} />
      ) : query.data ? (
        <EmptyState title="No featured lists yet">
          Lists built by people who use this site appear here when an admin features them.
        </EmptyState>
      ) : query.isPending ? (
        <LoadingRegion label="Loading the featured lists…">
          <ListRowsSkeleton rows={2} />
        </LoadingRegion>
      ) : (
        <ErrorState
          title="The featured lists could not be loaded"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}
    </Card>
  );
}
