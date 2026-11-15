import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  accountKeys,
  announcementsQuery,
  dismissAnnouncement,
  markNotificationRead,
  notificationsQuery,
  type AnnouncementsResponse,
  type NotificationsResponse,
} from '../../api/account';
import { describeApiError } from '../../api/errors';
import { Alert, type AlertTone } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { showToast } from '../../components/ui/toasts';
import { ANNOUNCEMENT_TONES } from '../../lib/notices';
import type { LimitReview, Notification } from '../../types';
import { limitConsequence, limitReviewSummary } from '../../utils/limitReview';

const NOTIFICATION_TONES: Record<string, AlertTone> = {
  limit_request_approved: 'ok',
  limit_request_denied: 'warn',
  domain_limit_exceeded: 'warn',
};

export function Announcements() {
  const client = useQueryClient();
  const { data } = useQuery(announcementsQuery());
  const dismissal = useMutation({
    mutationFn: dismissAnnouncement,
    onMutate: (id: string) => {
      client.setQueryData<AnnouncementsResponse>(accountKeys.announcements(), (current) =>
        current
          ? { announcements: current.announcements.filter((item) => item.id !== id) }
          : current,
      );
    },
    onError: (error) => {
      showToast('fail', describeApiError(error, 'The announcement could not be dismissed.'));
    },
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.announcements() }),
  });
  const announcements = data?.announcements ?? [];
  if (announcements.length === 0) return null;
  return (
    <>
      {announcements.map((announcement) => (
        <Alert
          key={announcement.id}
          tone={ANNOUNCEMENT_TONES[announcement.type] ?? 'info'}
          title={announcement.title}
          live={false}
          onDismiss={() => dismissal.mutate(announcement.id)}
          dismissLabel={`Dismiss announcement: ${announcement.title}`}
        >
          {announcement.message}
        </Alert>
      ))}
    </>
  );
}

function unread(notifications: Notification[]): Notification[] {
  return notifications.filter((notification) => !notification.read);
}

export function Notifications({ hideTypes = [] }: { hideTypes?: string[] }) {
  const client = useQueryClient();
  const { data } = useQuery(notificationsQuery());
  const markRead = useMutation({
    mutationFn: markNotificationRead,
    onMutate: (id: string) => {
      client.setQueryData<NotificationsResponse>(accountKeys.notifications(), (current) =>
        current
          ? {
              ...current,
              notifications: current.notifications.map((item) =>
                item.id === id ? { ...item, read: true } : item,
              ),
            }
          : current,
      );
    },
    onError: (error) => {
      showToast('fail', describeApiError(error, 'The notification could not be dismissed.'));
    },
    onSettled: () => client.invalidateQueries({ queryKey: accountKeys.notifications() }),
  });
  const notifications = unread(data?.notifications ?? []).filter(
    (notification) => !hideTypes.includes(notification.type),
  );
  if (notifications.length === 0) return null;
  return (
    <>
      {notifications.map((notification) => (
        <Alert
          key={notification.id}
          tone={NOTIFICATION_TONES[notification.type] ?? 'info'}
          title={notification.title}
          live={false}
          onDismiss={() => markRead.mutate(notification.id)}
          dismissLabel={`Dismiss notification: ${notification.title}`}
        >
          {notification.message}
        </Alert>
      ))}
    </>
  );
}

export interface OverLimitNoticeProps {
  review: LimitReview;
  enforcing: boolean;
  hasPendingRequest: boolean;
  canRequest: boolean;
  onRequest: () => void;
}

export function OverLimitNotice({
  review,
  enforcing,
  hasPendingRequest,
  canRequest,
  onRequest,
}: OverLimitNoticeProps) {
  return (
    <Alert
      tone="fail"
      title="Your lists are over the domain limit"
      actions={
        <>
          <Button to="/config" size="sm">
            Review sources
          </Button>
          {canRequest && !hasPendingRequest ? (
            <Button size="sm" onClick={onRequest}>
              Request a higher limit
            </Button>
          ) : null}
        </>
      }
    >
      <p>{limitReviewSummary(review)}</p>
      <p className="mt-1">
        {limitConsequence(enforcing)} Remove some sources, or ask for a higher limit.
        {hasPendingRequest ? ' Your limit request is waiting for review.' : ''}
      </p>
    </Alert>
  );
}
