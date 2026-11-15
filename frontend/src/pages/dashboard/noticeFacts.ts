import type { Announcement, Notification } from '../../types';

export const NOTICES_SHOWN = 2;

export type Notice =
  | { kind: 'announcement'; id: string; createdAt: string; announcement: Announcement }
  | { kind: 'notification'; id: string; createdAt: string; notification: Notification };

function rank(notice: Notice): number {
  if (notice.kind === 'notification') return 1;
  if (notice.announcement.type === 'critical') return 0;
  return notice.announcement.type === 'warning' ? 2 : 3;
}

function newestFirst(first: Notice, second: Notice): number {
  const difference = Date.parse(second.createdAt) - Date.parse(first.createdAt);
  if (Number.isFinite(difference) && difference !== 0) return difference;
  return first.id.localeCompare(second.id);
}

export function orderNotices(
  announcements: readonly Announcement[],
  notifications: readonly Notification[],
  hiddenNotificationTypes: readonly string[] = [],
): Notice[] {
  const notices: Notice[] = [
    ...announcements.map(
      (announcement): Notice => ({
        kind: 'announcement',
        id: `announcement-${announcement.id}`,
        createdAt: announcement.created_at,
        announcement,
      }),
    ),
    ...notifications
      .filter(
        (notification) =>
          !notification.read && !hiddenNotificationTypes.includes(notification.type),
      )
      .map(
        (notification): Notice => ({
          kind: 'notification',
          id: `notification-${notification.id}`,
          createdAt: notification.created_at,
          notification,
        }),
      ),
  ];
  return notices.sort((first, second) => rank(first) - rank(second) || newestFirst(first, second));
}

export interface NoticeSplit {
  shown: Notice[];
  more: Notice[];
}

export function splitNotices(notices: Notice[], limit: number = NOTICES_SHOWN): NoticeSplit {
  return { shown: notices.slice(0, limit), more: notices.slice(limit) };
}
