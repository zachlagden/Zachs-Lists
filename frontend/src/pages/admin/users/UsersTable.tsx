import { Link } from 'react-router-dom';
import type { AdminUserDetail } from '../../../api/admin';
import { Skeleton } from '../../../components/ui/Layout';
import { DescribedPill } from '../../../components/ui/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui/Table';
import { formatDate, formatInteger, formatRelativeTime } from '../../../lib/format';
import { avatarInitial, lastSeen, roleDescription, stateDescription } from './userFacts';
import { CELL_LINK } from '../../../components/ui/linkClasses';
import { cn } from '../../../lib/cn';

export function Avatar({ username, large = false }: { username: string; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={
        large
          ? 'grid size-11 flex-none place-items-center rounded-full bg-surface-raised text-base font-semibold text-text-secondary'
          : 'grid size-7 flex-none place-items-center rounded-full bg-surface-raised text-xs font-semibold text-text-secondary'
      }
    >
      {avatarInitial(username)}
    </span>
  );
}

export function UsersTable({ users, now }: { users: AdminUserDetail[]; now: Date }) {
  return (
    <Table>
      <caption className="sr-only">Accounts</caption>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Account</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Role</TableHeaderCell>
          <TableHeaderCell>State</TableHeaderCell>
          <TableHeaderCell align="right" hideOnNarrow>
            Lists
          </TableHeaderCell>
          <TableHeaderCell align="right">Domains</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Last seen</TableHeaderCell>
          <TableHeaderCell hideOnNarrow>Joined</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {users.map((user) => {
          const seen = lastSeen(user);
          return (
            <TableRow key={user.id}>
              <TableCell>
                <span className="flex min-w-0 items-center gap-2.5">
                  <Avatar username={user.username} />
                  <span className="grid min-w-0">
                    <Link
                      to={`/admin/users/${encodeURIComponent(user.id)}`}
                      className={cn(CELL_LINK, 'font-medium break-all')}
                    >
                      {user.username}
                    </Link>
                    {user.email ? (
                      <span className="text-xs break-all text-text-tertiary narrow:hidden">
                        {user.email}
                      </span>
                    ) : null}
                  </span>
                </span>
              </TableCell>
              <TableCell hideOnNarrow>
                <DescribedPill description={roleDescription(user)} />
              </TableCell>
              <TableCell>
                <DescribedPill description={stateDescription(user)} />
              </TableCell>
              <TableCell align="right" hideOnNarrow>
                {formatInteger(user.lists.length)}
              </TableCell>
              <TableCell align="right">{formatInteger(user.stats.total_domains)}</TableCell>
              <TableCell hideOnNarrow className="whitespace-nowrap text-text-secondary">
                {seen ? formatRelativeTime(seen, now) : 'Never'}
              </TableCell>
              <TableCell hideOnNarrow className="whitespace-nowrap text-text-secondary">
                {formatDate(user.created_at, { now })}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function UsersTableSkeleton() {
  return (
    <div className="grid gap-3 p-[18px]">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} className="h-7 w-full" />
      ))}
    </div>
  );
}
