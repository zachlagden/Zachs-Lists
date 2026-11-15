import { describe, expect, it } from 'vitest';
import type { Announcement, Notification } from '../../types';
import { orderNotices, splitNotices } from './noticeFacts';

function announcement(id: string, type: Announcement['type'], createdAt: string): Announcement {
  return {
    id,
    title: `Announcement ${id}`,
    message: 'Message',
    type,
    is_active: true,
    expires_at: null,
    created_by: 'sam',
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function notification(
  id: string,
  createdAt: string,
  read = false,
  type = 'limit_request_approved',
): Notification {
  return {
    id,
    type,
    title: `Notification ${id}`,
    message: 'Message',
    data: {},
    read,
    created_at: createdAt,
  };
}

const announcements = [
  announcement('info', 'info', '2026-11-10T10:00:00Z'),
  announcement('warning', 'warning', '2026-11-09T10:00:00Z'),
  announcement('critical-old', 'critical', '2026-11-01T10:00:00Z'),
  announcement('critical-new', 'critical', '2026-11-12T10:00:00Z'),
];
const notifications = [
  notification('read', '2026-11-13T10:00:00Z', true),
  notification('unread', '2026-11-11T10:00:00Z'),
  notification('over', '2026-11-14T10:00:00Z', false, 'domain_limit_exceeded'),
];

describe('dashboard notices', () => {
  it('puts critical announcements first, then notifications, then the rest, newest first', () => {
    expect(orderNotices(announcements, notifications).map((notice) => notice.id)).toEqual([
      'announcement-critical-new',
      'announcement-critical-old',
      'notification-over',
      'notification-unread',
      'announcement-warning',
      'announcement-info',
    ]);
  });

  it('gives the same order whatever order the server sent', () => {
    const forwards = orderNotices(announcements, notifications);
    const backwards = orderNotices([...announcements].reverse(), [...notifications].reverse());
    expect(backwards.map((notice) => notice.id)).toEqual(forwards.map((notice) => notice.id));
  });

  it('leaves out read notifications and the types the page shows elsewhere', () => {
    const ids = orderNotices([], notifications, ['domain_limit_exceeded']).map(
      (notice) => notice.id,
    );
    expect(ids).toEqual(['notification-unread']);
  });

  it('shows two and keeps the rest behind the disclosure', () => {
    const { shown, more } = splitNotices(orderNotices(announcements, notifications));
    expect(shown).toHaveLength(2);
    expect(more).toHaveLength(4);
    expect(splitNotices(orderNotices([], [notifications[1]])).more).toEqual([]);
  });
});
