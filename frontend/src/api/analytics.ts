import { queryOptions } from '@tanstack/react-query';
import type {
  AdminAnalytics,
  AnalyticsReport,
  ListAnalyticsReport,
  PublicAnalyticsReport,
  PublicStats,
} from '../types';
import { get } from './http';

export const DEFAULT_ANALYTICS_DAYS = 30;

export const analyticsKeys = {
  all: ['analytics'] as const,
  user: (days: number) => [...analyticsKeys.all, 'user', days] as const,
  userList: (listName: string, days: number) =>
    [...analyticsKeys.all, 'user-list', listName, days] as const,
  defaults: (days: number) => [...analyticsKeys.all, 'defaults', days] as const,
  admin: (days: number) => [...analyticsKeys.all, 'admin', days] as const,
  publicStats: () => [...analyticsKeys.all, 'public-stats'] as const,
};

export function fetchUserAnalytics(days: number): Promise<AnalyticsReport> {
  return get<AnalyticsReport>('/api/analytics/user', { days });
}

export function fetchUserListAnalytics(
  listName: string,
  days: number,
): Promise<ListAnalyticsReport> {
  return get<ListAnalyticsReport>(`/api/analytics/user/${encodeURIComponent(listName)}`, {
    days,
  });
}

export function fetchDefaultAnalytics(days: number): Promise<PublicAnalyticsReport> {
  return get<PublicAnalyticsReport>('/api/analytics/default', { days });
}

export function fetchAdminAnalytics(days: number): Promise<AdminAnalytics> {
  return get<AdminAnalytics>('/api/analytics/admin', { days });
}

export function fetchPublicStats(): Promise<PublicStats> {
  return get<PublicStats>('/api/analytics/public/stats');
}

export const userAnalyticsQuery = (days: number = DEFAULT_ANALYTICS_DAYS) =>
  queryOptions({
    queryKey: analyticsKeys.user(days),
    queryFn: () => fetchUserAnalytics(days),
  });

export const userListAnalyticsQuery = (listName: string, days: number = DEFAULT_ANALYTICS_DAYS) =>
  queryOptions({
    queryKey: analyticsKeys.userList(listName, days),
    queryFn: () => fetchUserListAnalytics(listName, days),
  });

export const defaultAnalyticsQuery = (days: number = DEFAULT_ANALYTICS_DAYS) =>
  queryOptions({
    queryKey: analyticsKeys.defaults(days),
    queryFn: () => fetchDefaultAnalytics(days),
  });

export const adminAnalyticsQuery = (days: number = DEFAULT_ANALYTICS_DAYS) =>
  queryOptions({
    queryKey: analyticsKeys.admin(days),
    queryFn: () => fetchAdminAnalytics(days),
  });

export const publicStatsQuery = () =>
  queryOptions({ queryKey: analyticsKeys.publicStats(), queryFn: fetchPublicStats });
