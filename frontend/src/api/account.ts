import { queryOptions } from '@tanstack/react-query';
import type { Announcement, IntendedUse, LimitRequest, Notification } from '../types';
import { get, post } from './http';

export interface LimitRequestsResponse {
  requests: LimitRequest[];
  current_limit: number;
  available_tiers: number[];
  has_pending: boolean;
  max_limit: number;
}

export interface LimitRequestSubmission {
  requestedTier: number;
  reason: string;
  intendedUse: IntendedUse;
}

export interface NotificationsResponse {
  notifications: Notification[];
  unread_count: number;
}

export interface AnnouncementsResponse {
  announcements: Announcement[];
}

export const accountKeys = {
  all: ['account'] as const,
  limitRequests: () => [...accountKeys.all, 'limit-requests'] as const,
  notifications: () => [...accountKeys.all, 'notifications'] as const,
  announcements: () => [...accountKeys.all, 'announcements'] as const,
};

export function fetchLimitRequests(): Promise<LimitRequestsResponse> {
  return get<LimitRequestsResponse>('/api/user/limit-request');
}

export function submitLimitRequest(
  submission: LimitRequestSubmission,
): Promise<{ success: boolean; request: LimitRequest }> {
  return post<{ success: boolean; request: LimitRequest }>('/api/user/limit-request', {
    requested_tier: submission.requestedTier,
    reason: submission.reason,
    intended_use: submission.intendedUse,
  });
}

export function fetchNotifications(): Promise<NotificationsResponse> {
  return get<NotificationsResponse>('/api/user/notifications');
}

export function markNotificationRead(notificationId: string): Promise<{ success: boolean }> {
  return post<{ success: boolean }>(
    `/api/user/notifications/${encodeURIComponent(notificationId)}/read`,
  );
}

export function fetchAnnouncements(): Promise<AnnouncementsResponse> {
  return get<AnnouncementsResponse>('/api/user/announcements');
}

export function dismissAnnouncement(announcementId: string): Promise<{ success: boolean }> {
  return post<{ success: boolean }>(
    `/api/user/announcements/${encodeURIComponent(announcementId)}/dismiss`,
  );
}

export const limitRequestsQuery = () =>
  queryOptions({ queryKey: accountKeys.limitRequests(), queryFn: fetchLimitRequests });

export const notificationsQuery = () =>
  queryOptions({ queryKey: accountKeys.notifications(), queryFn: fetchNotifications });

export const announcementsQuery = () =>
  queryOptions({ queryKey: accountKeys.announcements(), queryFn: fetchAnnouncements });
