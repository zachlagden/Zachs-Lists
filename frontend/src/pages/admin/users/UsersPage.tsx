import { useQuery } from '@tanstack/react-query';
import { adminUsersQuery } from '../../../api/admin';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field, Input, Select } from '../../../components/ui/Field';
import { LoadingRegion, PageHeader } from '../../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import { useNow } from '../../../lib/useNow';
import { Pagination } from '../shared/Pagination';
import { useDebouncedValue, useUrlState, useUrlText } from '../shared/useUrlState';
import { SEARCH_DEBOUNCE_MS, apiFilters, isFiltered, userListState } from './userFacts';
import { UsersTable, UsersTableSkeleton } from './UsersTable';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';

const CLEARED = { q: null, role: null, state: null, banned: null, page: null };
const FIRST_PAGE = { page: null };

export default function UsersPage() {
  useDocumentMeta(adminTitle('Users'));
  const now = useNow();
  const url = useUrlState();
  const { params, update } = url;
  const state = userListState(params);
  const [typed, setTyped] = useUrlText(url, 'q', FIRST_PAGE);
  const search = useDebouncedValue(typed, SEARCH_DEBOUNCE_MS);
  const users = useQuery(adminUsersQuery(apiFilters(state, search)));

  const clear = () => {
    setTyped('');
    update(CLEARED);
  };

  return (
    <>
      <PageHeader
        title="Users"
        description="Every account except your own. Open one to change its limits or access."
      />
      <Card as="section" aria-label="Accounts">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-end gap-3 border-b border-border p-[18px] compact:grid-cols-[repeat(2,minmax(0,1fr))] narrow:grid-cols-[minmax(0,1fr)] narrow:p-3">
          <Field label="Search by username or email">
            <Input
              type="search"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder="alex or alex@example.com"
              maxLength={100}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Role">
            <Select
              value={state.role}
              onChange={(event) =>
                update({
                  role: event.target.value === 'all' ? null : event.target.value,
                  page: null,
                })
              }
            >
              <option value="all">Any role</option>
              <option value="admins">Admins</option>
              <option value="members">Members</option>
            </Select>
          </Field>
          <Field label="State">
            <Select
              value={state.state}
              onChange={(event) =>
                update({
                  state: event.target.value === 'all' ? null : event.target.value,
                  page: null,
                })
              }
            >
              <option value="all">Enabled or disabled</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </Select>
          </Field>
          <label className="flex h-9 items-center gap-2 text-[13px] whitespace-nowrap narrow:min-h-11">
            <input
              type="checkbox"
              checked={state.bannedOnly}
              onChange={(event) => update({ banned: event.target.checked, page: null })}
              className="size-4 accent-[var(--accent-start)]"
            />
            Banned only
          </label>
        </div>
        {users.data ? (
          <div aria-busy={users.isPlaceholderData || undefined}>
            {users.data.users.length === 0 ? (
              <EmptyState
                title={isFiltered(state) ? 'No account matches these filters' : 'No other accounts'}
                action={
                  isFiltered(state) ? (
                    <Button size="sm" onClick={clear}>
                      Clear the filters
                    </Button>
                  ) : undefined
                }
              >
                {isFiltered(state)
                  ? 'Search matches part of a username or an email address.'
                  : 'Accounts appear here when people sign in with GitHub.'}
              </EmptyState>
            ) : (
              <UsersTable users={users.data.users} now={now} />
            )}
            <Pagination
              label="Pages of accounts"
              page={users.data.page}
              pages={users.data.pages}
              perPage={users.data.per_page}
              total={users.data.total}
              noun="accounts"
              onPageChange={(page) => update({ page: page === 1 ? null : page })}
            />
          </div>
        ) : users.isError ? (
          <ErrorState
            title="Accounts could not be loaded"
            headingLevel="h2"
            error={users.error}
            onRetry={() => void users.refetch()}
            retrying={users.isFetching}
          />
        ) : (
          <LoadingRegion label="Loading accounts…">
            <UsersTableSkeleton />
          </LoadingRegion>
        )}
      </Card>
    </>
  );
}
