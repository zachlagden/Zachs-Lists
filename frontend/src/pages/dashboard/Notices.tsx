import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
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
import { pluralise } from '../../lib/format';
import type { LimitReview } from '../../types';
import { limitConsequence, limitReviewSummary } from '../../utils/limitReview';
import { orderNotices, splitNotices, type Notice } from './noticeFacts';

const NOTIFICATION_TONES: Record<string, AlertTone> = {
  limit_request_approved: 'ok',
  limit_request_denied: 'warn',
  domain_limit_exceeded: 'warn',
};

export function DashboardNotices({
  hiddenNotificationTypes,
}: {
  hiddenNotificationTypes: readonly string[];
}) {
  const client = useQueryClient();
  const moreId = useId();
  const [expanded, setExpanded] = useState(false);
  const announcements = useQuery(announcementsQuery());
  const notifications = useQuery(notificationsQuery());
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

  const notices = orderNotices(
    announcements.data?.announcements ?? [],
    notifications.data?.notifications ?? [],
    hiddenNotificationTypes,
  );
  if (notices.length === 0) return null;
  const { shown, more } = splitNotices(notices);

  const renderNotice = (notice: Notice) =>
    notice.kind === 'announcement' ? (
      <Alert
        key={notice.id}
        tone={ANNOUNCEMENT_TONES[notice.announcement.type] ?? 'info'}
        title={notice.announcement.title}
        live={false}
        onDismiss={() => dismissal.mutate(notice.announcement.id)}
        dismissLabel={`Dismiss announcement: ${notice.announcement.title}`}
      >
        {notice.announcement.message}
      </Alert>
    ) : (
      <Alert
        key={notice.id}
        tone={NOTIFICATION_TONES[notice.notification.type] ?? 'info'}
        title={notice.notification.title}
        live={false}
        onDismiss={() => markRead.mutate(notice.notification.id)}
        dismissLabel={`Dismiss notification: ${notice.notification.title}`}
      >
        {notice.notification.message}
      </Alert>
    );

  return (
    <section aria-label="Announcements and notifications" className="grid gap-2">
      {shown.map(renderNotice)}
      {more.length > 0 ? (
        <>
          <div id={moreId} hidden={!expanded} className="grid gap-2">
            {more.map(renderNotice)}
          </div>
          <div>
            <Button
              size="sm"
              variant="ghost"
              icon={expanded ? 'chevron-down' : 'chevron-right'}
              aria-expanded={expanded}
              aria-controls={moreId}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Show fewer' : `${pluralise(more.length, 'more notice')}`}
            </Button>
          </div>
        </>
      ) : null}
    </section>
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
