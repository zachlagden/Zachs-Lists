import { queryOptions } from '@tanstack/react-query';
import type { DefaultList, FeaturedList, UserLimits, UserList, UserStats } from '../types';
import { get } from './http';

export interface UserListsResponse {
  lists: UserList[];
  published_at: string | null;
  generation_id: string | null;
  stats: UserStats;
  limits: UserLimits;
  remaining_updates: number;
  enforce_domain_limit: boolean;
}

export interface FeaturedListSummary extends FeaturedList {
  domain_count: number;
  last_updated: string | null;
}

export const listsKeys = {
  all: ['lists'] as const,
  mine: () => [...listsKeys.all, 'mine'] as const,
  defaults: () => [...listsKeys.all, 'defaults'] as const,
  featured: () => [...listsKeys.all, 'featured'] as const,
};

export function fetchUserLists(): Promise<UserListsResponse> {
  return get<UserListsResponse>('/api/user/lists');
}

export function fetchDefaultLists(): Promise<DefaultList[]> {
  return get<DefaultList[]>('/api/lists');
}

export function fetchFeaturedLists(): Promise<FeaturedListSummary[]> {
  return get<FeaturedListSummary[]>('/api/browse/featured');
}

export const userListsQuery = () =>
  queryOptions({ queryKey: listsKeys.mine(), queryFn: fetchUserLists });

export const defaultListsQuery = () =>
  queryOptions({ queryKey: listsKeys.defaults(), queryFn: fetchDefaultLists });

export const featuredListsQuery = () =>
  queryOptions({ queryKey: listsKeys.featured(), queryFn: fetchFeaturedLists });
