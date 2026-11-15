import type { QueryClient } from '@tanstack/react-query';
import { adminKeys, type AdminUserDetail, type AdminUsersPage } from '../../../../api/admin';

const USER_LISTS = [...adminKeys.users(), 'list'] as const;

export function storeUser(client: QueryClient, user: AdminUserDetail): void {
  client.setQueryData<AdminUserDetail>(adminKeys.user(user.id), user);
  client.setQueriesData<AdminUsersPage>({ queryKey: USER_LISTS }, (page) =>
    page ? { ...page, users: page.users.map((row) => (row.id === user.id ? user : row)) } : page,
  );
}

export function patchUser(
  client: QueryClient,
  userId: string,
  changes: Partial<AdminUserDetail>,
): void {
  const current = client.getQueryData<AdminUserDetail>(adminKeys.user(userId));
  if (current) storeUser(client, { ...current, ...changes });
}

export function forgetUser(client: QueryClient, userId: string): void {
  client.removeQueries({ queryKey: adminKeys.user(userId) });
  void client.invalidateQueries({ queryKey: USER_LISTS });
  void client.invalidateQueries({ queryKey: adminKeys.stats() });
  void client.invalidateQueries({ queryKey: adminKeys.limitReviews() });
  void client.invalidateQueries({ queryKey: adminKeys.limitRequests() });
  void client.invalidateQueries({ queryKey: adminKeys.featured() });
  void client.invalidateQueries({ queryKey: adminKeys.jobs() });
}
