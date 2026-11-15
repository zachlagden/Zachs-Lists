import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { defaultConfigQuery, defaultSyncQuery } from '../../../api/admin';
import { defaultListsQuery } from '../../../api/lists';
import { Button } from '../../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card';
import { LoadingRegion, PageHeader, Skeleton, Stack } from '../../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui/Table';
import { formatBytes, formatDateTime, formatInteger } from '../../../lib/format';
import { useNow } from '../../../lib/useNow';
import { ConfigEditor } from './ConfigEditor';
import { ConfigViewer } from './ConfigViewer';
import { SyncCard } from './SyncCard';

function CardSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} className="grid gap-3 p-[18px]">
      <Skeleton className="h-4 w-56" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-2/3" />
    </LoadingRegion>
  );
}

function PublishedLists({ now }: { now: Date }) {
  const lists = useQuery(defaultListsQuery());
  return (
    <Card as="section" aria-labelledby="default-published">
      <CardHeader title="Published default lists" titleId="default-published" />
      {lists.data ? (
        lists.data.length === 0 ? (
          <EmptyState title="No default list is published yet">
            Rebuild the default lists to publish them.
          </EmptyState>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>List</TableHeaderCell>
                <TableHeaderCell hideOnNarrow>Formats</TableHeaderCell>
                <TableHeaderCell align="right">Domains</TableHeaderCell>
                <TableHeaderCell align="right" hideOnNarrow>
                  Size
                </TableHeaderCell>
                <TableHeaderCell hideOnNarrow>Published</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {lists.data.map((list) => (
                <TableRow key={list.name}>
                  <TableCell className="font-mono text-[13px] break-all">{list.name}</TableCell>
                  <TableCell hideOnNarrow className="text-text-secondary">
                    {list.formats.join(', ')}
                  </TableCell>
                  <TableCell align="right">
                    {typeof list.domain_count === 'number'
                      ? formatInteger(list.domain_count)
                      : 'Unknown'}
                  </TableCell>
                  <TableCell align="right" hideOnNarrow className="whitespace-nowrap">
                    {formatBytes(list.size_bytes)}
                  </TableCell>
                  <TableCell hideOnNarrow className="whitespace-nowrap text-text-secondary">
                    {formatDateTime(list.published_at ?? list.last_updated, { now }) || 'Unknown'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : lists.isError ? (
        <ErrorState
          title="The published lists could not be loaded"
          error={lists.error}
          onRetry={() => void lists.refetch()}
          retrying={lists.isFetching}
        />
      ) : (
        <CardSkeleton label="Loading the published lists…" />
      )}
    </Card>
  );
}

export default function DefaultListsPage() {
  const now = useNow();
  const config = useQuery(defaultConfigQuery());
  const status = useQuery(defaultSyncQuery());
  const [editing, setEditing] = useState(false);
  const ready = config.data && status.data ? { config: config.data, status: status.data } : null;
  const error = config.error ?? status.error;
  const editable = ready !== null && !ready.config.sync_enabled;

  return (
    <>
      <PageHeader
        title="Default lists"
        description="The lists every visitor can use without an account, and the sources they are built from."
      />
      <Stack>
        {ready ? (
          <>
            <SyncCard config={ready.config} status={ready.status} now={now} />
            <PublishedLists now={now} />
            <Card as="section" aria-labelledby="default-config">
              <CardHeader
                title="Sources and whitelist"
                titleId="default-config"
                actions={
                  editable && !editing ? (
                    <Button size="sm" onClick={() => setEditing(true)}>
                      Edit
                    </Button>
                  ) : !editable ? (
                    <span>Read only while sync is on</span>
                  ) : null
                }
                className="flex-wrap"
              />
              <CardBody>
                {editable && editing ? (
                  <ConfigEditor config={ready.config} onDone={() => setEditing(false)} />
                ) : (
                  <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-4 compact:grid-cols-[minmax(0,1fr)]">
                    <ConfigViewer
                      title="Sources"
                      text={ready.config.config}
                      emptyMessage="No sources are stored."
                    />
                    <ConfigViewer
                      title="Whitelist"
                      text={ready.config.whitelist}
                      emptyMessage="The whitelist is empty."
                    />
                  </div>
                )}
              </CardBody>
            </Card>
          </>
        ) : error ? (
          <Card>
            <ErrorState
              title="The default list settings could not be loaded"
              headingLevel="h2"
              error={error}
              onRetry={() => {
                void config.refetch();
                void status.refetch();
              }}
              retrying={config.isFetching || status.isFetching}
            />
          </Card>
        ) : (
          <Card>
            <CardSkeleton label="Loading the default list settings…" />
          </Card>
        )}
      </Stack>
    </>
  );
}
