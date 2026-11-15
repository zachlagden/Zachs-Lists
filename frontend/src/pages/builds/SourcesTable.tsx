import { useMemo } from 'react';
import { Card, CardHeader } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { EmptyState } from '../../components/ui/States';
import { Table, TableBody, TableHead, TableHeaderCell, TableRow } from '../../components/ui/Table';
import type { SourceProgress } from '../../types';
import { sortSources, sourceTally } from './sourceFacts';
import { SourceRow } from './SourceRow';

function Tally({ sources }: { sources: SourceProgress[] }) {
  const tally = sourceTally(sources);
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {tally.problems > 0 ? (
        <StatusPill tone="warn" icon="warn">
          {tally.problems} {tally.problems === 1 ? 'problem' : 'problems'}
        </StatusPill>
      ) : null}
      <StatusPill tone="ok" icon="check">
        {tally.finished - tally.problems} done
      </StatusPill>
      {tally.active > 0 ? (
        <StatusPill tone="info" icon="loop" spin>
          {tally.active} active
        </StatusPill>
      ) : null}
      {tally.waiting > 0 ? <StatusPill icon="clock">{tally.waiting} waiting</StatusPill> : null}
    </div>
  );
}

export interface SourcesTableProps {
  sources: SourceProgress[];
  emptyMessage: string;
}

export function SourcesTable({ sources, emptyMessage }: SourcesTableProps) {
  const sorted = useMemo(() => sortSources(sources), [sources]);
  return (
    <Card as="section" aria-labelledby="build-sources">
      <CardHeader
        title="Sources"
        titleId="build-sources"
        actions={sources.length > 0 ? <Tally sources={sources} /> : null}
      />
      {sorted.length === 0 ? (
        <EmptyState title="No sources to show">{emptyMessage}</EmptyState>
      ) : (
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Source</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell hideOnNarrow>Download</TableHeaderCell>
              <TableHeaderCell align="right">Domains</TableHeaderCell>
              <TableHeaderCell align="right" hideOnNarrow>
                Change
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
