import { queryOptions } from '@tanstack/react-query';
import type { AdminAnalytics, AnalyticsReport } from '../types';
import { get } from './http';

export const DEFAULT_ANALYTICS_DAYS = 30;

export const analyticsKeys = {
  all: ['analytics'] as const,
  user: (days: number) => [...analyticsKeys.all, 'user', days] as const,
  admin: (days: number) => [...analyticsKeys.all, 'admin', days] as const,
};

export function fetchUserAnalytics(days: number): Promise<AnalyticsReport> {
  return get<AnalyticsReport>('/api/analytics/user', { days });
}

export function fetchAdminAnalytics(days: number): Promise<AdminAnalytics> {
  return get<AdminAnalytics>('/api/analytics/admin', { days });
}

export const userAnalyticsQuery = (days: number = DEFAULT_ANALYTICS_DAYS) =>
  queryOptions({
    queryKey: analyticsKeys.user(days),
    queryFn: () => fetchUserAnalytics(days),
  });

export const adminAnalyticsQuery = (days: number = DEFAULT_ANALYTICS_DAYS) =>
  queryOptions({
    queryKey: analyticsKeys.admin(days),
    queryFn: () => fetchAdminAnalytics(days),
  });
