import { SITE_URL } from '../../config/site';
import { formatDateTime } from '../../lib/format';
import {
  defaultListAddress,
  defaultListPath,
  describeDefaultList,
  exactDomains,
  offersFormat,
  publishedTime,
  roundedDomains,
} from '../../lib/listCatalogue';
import type { DefaultList, ListFormat } from '../../types';
import { Skeleton } from '../ui/Layout';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '../ui/Table';
import { ListActions } from './ListActions';

export interface DefaultListsTableProps {
  lists: DefaultList[];
  format: ListFormat;
  detailed?: boolean;
  now: Date;
}

export function DefaultListsTable({
  lists,
  format,
  detailed = false,
  now,
}: DefaultListsTableProps) {
  const count = detailed ? exactDomains : roundedDomains;
  return (
    <Table>
      <TableHead>
        <TableRow>
          <TableHeaderCell>List</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>What it blocks</TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Domains
          </TableHeaderCell>
          {detailed ? (
            <TableHeaderCell align="right" hideOnNarrow>
              Published
            </TableHeaderCell>
          ) : null}
          <TableHeaderCell align="right">
            <span className="sr-only">Address</span>
          </TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {lists.map((list) => (
          <TableRow key={list.name}>
            <TableCell>
              <b className="font-medium" translate="no">
                {list.name}
              </b>
              <span className="hidden text-[13px] text-text-secondary narrow:block">
                {describeDefaultList(list.name)}
              </span>
              <span className="num hidden text-[13px] text-text-tertiary narrow:block">
                {count(list.domain_count)} domains
              </span>
            </TableCell>
            <TableCell hideOnNarrow className="text-text-secondary">
              {describeDefaultList(list.name)}
            </TableCell>
            <TableCell align="right" hideOnNarrow className="whitespace-nowrap">
              {count(list.domain_count)}
            </TableCell>
            {detailed ? (
              <TableCell
                align="right"
                hideOnNarrow
                className="whitespace-nowrap text-text-secondary"
              >
                {formatDateTime(publishedTime(list), { now }) || 'Unknown'}
              </TableCell>
            ) : null}
            <TableCell align="right">
              <ListActions
                listLabel={list.name}
                format={format}
                available={offersFormat(list.formats, format)}
                address={defaultListAddress(SITE_URL, list.name, format)}
                openPath={detailed ? defaultListPath(list.name, format) : undefined}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function ListRowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="flex items-center gap-4 border-b border-border px-[18px] py-3.5 last:border-b-0 narrow:px-3"
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-56 narrow:hidden" />
          <span className="flex-1" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
