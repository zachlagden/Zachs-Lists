import { useState } from 'react';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { SegmentedControl, type SegmentOption } from '../../components/ui/SegmentedControl';
import { EmptyState } from '../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../components/ui/Table';
import { UrlField } from '../../components/ui/UrlField';
import { SITE_URL } from '../../config/site';
import { formatBytes, formatInteger } from '../../lib/format';
import type { Job, ListFormat, UserList } from '../../types';
import { COMBINED_LIST, categoryLists, compressedSize, listAddress } from './dashboardFacts';

const FORMAT_OPTIONS: ReadonlyArray<SegmentOption<ListFormat>> = [
  { value: 'hosts', label: 'Hosts' },
  { value: 'plain', label: 'Plain' },
  { value: 'adblock', label: 'Adblock' },
];

const FORMAT_NOTES: Record<ListFormat, string> = {
  hosts: 'Pi-hole and AdGuard Home read the hosts format.',
  plain: 'The plain format has one domain on each line.',
  adblock: 'The Adblock format suits AdGuard Home and browser content blockers.',
};

export interface ListAddressProps {
  username: string;
  lists: UserList[];
  publishedBuild: Job | null;
}

export function ListAddress({ username, lists, publishedBuild }: ListAddressProps) {
  const [format, setFormat] = useState<ListFormat>('hosts');
  const combined = lists.find((list) => list.name === COMBINED_LIST) ?? lists[0];
  const categories = categoryLists(lists);
  const size = combined ? compressedSize(publishedBuild, combined.name, format) : null;
  return (
    <Card as="section" aria-labelledby="list-address">
      <CardHeader
        title="List address"
        titleId="list-address"
        actions={
          combined ? (
            <SegmentedControl
              label="Format"
              options={FORMAT_OPTIONS}
              value={format}
              onChange={setFormat}
            />
          ) : null
        }
      />
      {combined ? (
        <CardBody className="grid gap-4">
          <UrlField
            label="List address"
            url={listAddress(SITE_URL, username, combined.name, format)}
          />
          <p className="text-[13px] text-text-secondary">
            The address never changes. {FORMAT_NOTES[format]}
            {size === null ? '' : ` ${formatBytes(size)} compressed.`}
          </p>
          {categories.length > 0 ? (
            <Table flush>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Category list</TableHeaderCell>
                  <TableHeaderCell align="right">Domains</TableHeaderCell>
                  <TableHeaderCell align="right">
                    <span className="sr-only">Copy address</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {categories.map((list) => (
                  <TableRow key={list.name}>
                    <TableCell translate="no">{list.name}</TableCell>
                    <TableCell align="right">{formatInteger(list.domain_count)}</TableCell>
                    <TableCell align="right">
                      <CopyButton
                        variant="ghost"
                        text={listAddress(SITE_URL, username, list.name, format)}
                        subject={`the ${list.name} list address`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardBody>
      ) : (
        <EmptyState title="No address yet">
          Your list gets its address when the first build finishes. The address then stays the same
          for every later build.
        </EmptyState>
      )}
    </Card>
  );
}
