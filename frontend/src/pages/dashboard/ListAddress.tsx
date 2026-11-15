import { useState } from 'react';
import { FormatSwitch } from '../../components/lists/FormatSwitch';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
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
import { compressedSize } from '../../lib/builds';
import {
  COMBINED_LIST,
  FORMAT_USES,
  SERVER_DEFAULT_FORMAT,
  userListAddress,
} from '../../lib/listCatalogue';
import { categoryLists } from './dashboardFacts';

export interface ListAddressProps {
  username: string;
  lists: UserList[];
  publishedBuild: Job | null;
}

export function ListAddress({ username, lists, publishedBuild }: ListAddressProps) {
  const [format, setFormat] = useState<ListFormat>(SERVER_DEFAULT_FORMAT);
  const combined = lists.find((list) => list.name === COMBINED_LIST) ?? lists[0];
  const categories = categoryLists(lists);
  const size = combined ? compressedSize(publishedBuild, combined.name, format) : null;
  return (
    <Card as="section" aria-labelledby="list-address">
      <CardHeader
        title="List address"
        titleId="list-address"
        actions={combined ? <FormatSwitch value={format} onChange={setFormat} /> : null}
      />
      {combined ? (
        <CardBody className="grid gap-4">
          <UrlField
            label="List address"
            url={userListAddress(SITE_URL, username, combined.name, format)}
          />
          <p className="text-[13px] text-text-secondary">
            The address never changes. {FORMAT_USES[format]}
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
                        text={userListAddress(SITE_URL, username, list.name, format)}
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
