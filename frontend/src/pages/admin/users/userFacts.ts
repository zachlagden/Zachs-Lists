import type { AdminUserDetail, AdminUserFilters } from '../../../api/admin';
import type { StatusDescription } from '../../../components/ui/status';
import { formatDateTime, parseApiDate } from '../../../lib/format';
import { choiceFromSearch, pageFromSearch } from '../shared/urlState';

export const SEARCH_DEBOUNCE_MS = 300;

export const ROLE_FILTERS = ['all', 'admins', 'members'] as const;
export const STATE_FILTERS = ['all', 'enabled', 'disabled'] as const;

export type RoleFilter = (typeof ROLE_FILTERS)[number];
export type StateFilter = (typeof STATE_FILTERS)[number];

export interface UserListState {
  search: string;
  role: RoleFilter;
  state: StateFilter;
  bannedOnly: boolean;
  page: number;
}

export function userListState(params: URLSearchParams): UserListState {
  return {
    search: params.get('q') ?? '',
    role: choiceFromSearch(params, 'role', ROLE_FILTERS, 'all'),
    state: choiceFromSearch(params, 'state', STATE_FILTERS, 'all'),
    bannedOnly: params.get('banned') === '1',
    page: pageFromSearch(params),
  };
}

export function isFiltered(state: UserListState): boolean {
  return state.search !== '' || state.role !== 'all' || state.state !== 'all' || state.bannedOnly;
}

export function apiFilters(state: UserListState, search: string): AdminUserFilters {
  return {
    page: state.page,
    search: search.trim(),
    showAdmins: state.role !== 'members',
    showRegular: state.role !== 'admins',
    showEnabled: state.state !== 'disabled',
    showDisabled: state.state !== 'enabled',
    bannedOnly: state.bannedOnly,
  };
}

type RoleSubject = Pick<AdminUserDetail, 'is_root' | 'is_admin'>;

export function roleDescription(user: RoleSubject): StatusDescription {
  if (user.is_root) return { tone: 'info', icon: 'shield', label: 'Root' };
  if (user.is_admin) return { tone: 'info', icon: 'shield', label: 'Admin' };
  return { tone: 'neutral', icon: 'dash', label: 'Member' };
}

type StateSubject = Pick<AdminUserDetail, 'is_banned' | 'is_enabled'>;

export function stateDescription(user: StateSubject): StatusDescription {
  if (user.is_banned) return { tone: 'fail', icon: 'fail', label: 'Banned' };
  if (!user.is_enabled) return { tone: 'warn', icon: 'warn', label: 'Disabled' };
  return { tone: 'ok', icon: 'check', label: 'Enabled' };
}

export function lastSeen(user: Pick<AdminUserDetail, 'ip_log'>): Date | null {
  const times = user.ip_log
    .map((entry) => parseApiDate(entry.last_seen)?.getTime())
    .filter((time): time is number => time !== undefined);
  return times.length === 0 ? null : new Date(Math.max(...times));
}

export function avatarInitial(username: string): string {
  return (username.trim()[0] ?? '?').toUpperCase();
}

const PERMANENT_BAN_YEARS = 50;

export function banEnd(bannedUntil: string | null, now: Date): string {
  const until = parseApiDate(bannedUntil);
  if (!until) return 'No end recorded';
  const years = (until.getTime() - now.getTime()) / (365.25 * 86_400_000);
  return years > PERMANENT_BAN_YEARS ? 'Permanent' : `Until ${formatDateTime(until, { now })}`;
}
