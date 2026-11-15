import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { DEFAULT_SOURCES_URL } from '../../config/site';
import { formatDateTime } from '../../lib/format';
import {
  REBUILD_SCHEDULE,
  SERVER_DEFAULT_FORMAT,
  latestPublishedTime,
  orderLists,
} from '../../lib/listCatalogue';
import { useNow } from '../../lib/useNow';
import type { DefaultList, ListFormat } from '../../types';
import { Card, CardHeader } from '../ui/Card';
import { LoadingRegion } from '../ui/Layout';
import { EmptyState, ErrorState } from '../ui/States';
import { DefaultListsTable, ListRowsSkeleton } from './DefaultListsTable';
import { FormatSwitch } from './FormatSwitch';
import { INLINE_LINK } from '../ui/linkClasses';

export interface DefaultListsCardProps {
  query: Pick<
    UseQueryResult<DefaultList[]>,
    'data' | 'error' | 'isPending' | 'isFetching' | 'refetch'
  >;
  detailed?: boolean;
}

export function DefaultListsCard({ query, detailed = false }: DefaultListsCardProps) {
  const [format, setFormat] = useState<ListFormat>(SERVER_DEFAULT_FORMAT);
  const now = useNow();
  const lists = query.data ? orderLists(query.data, (list) => list.name) : null;
  const published = lists ? latestPublishedTime(lists) : null;
  return (
    <Card as="section" id="lists" aria-labelledby="default-lists" className="scroll-mt-6">
      <CardHeader
        title="Default lists"
        titleId="default-lists"
        actions={
          <>
            <span className="narrow:hidden">
              {published ? `Published ${formatDateTime(published, { now })} · ` : ''}no account
              needed
            </span>
            <FormatSwitch value={format} onChange={setFormat} label="Default list format" />
          </>
        }
      />
      {lists && lists.length > 0 ? (
        <DefaultListsTable lists={lists} format={format} detailed={detailed} now={now} />
      ) : lists ? (
        <EmptyState title="No default lists are published yet">
          The default lists appear here after their first build finishes.
        </EmptyState>
      ) : query.isPending ? (
        <LoadingRegion label="Loading the default lists…">
          <ListRowsSkeleton />
        </LoadingRegion>
      ) : (
        <ErrorState
          title="The default lists could not be loaded"
          error={query.error}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      )}
      <p className="border-t border-border px-[18px] py-3 text-[13px] text-text-secondary narrow:px-3">
        Rebuilt {REBUILD_SCHEDULE} from the sources and whitelist of{' '}
        <a
          href={DEFAULT_SOURCES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={INLINE_LINK}
          translate="no"
        >
          Pi-hole-Optimized-Blocklists
        </a>
        . The address of each list stays the same after every rebuild.
      </p>
    </Card>
  );
}
