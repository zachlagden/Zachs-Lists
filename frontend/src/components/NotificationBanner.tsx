import { userApi } from '../api/client';
import type { Notification } from '../types';

interface NotificationBannerProps {
  notifications: Notification[];
  onDismiss: (id: string) => void;
}

function formatDomains(count: number): string {
  if (count >= 1_000_000) return (count / 1_000_000).toFixed(1) + 'M';
  if (count >= 1_000) return (count / 1_000).toFixed(0) + 'K';
  return count.toLocaleString();
}

export default function NotificationBanner({ notifications, onDismiss }: NotificationBannerProps) {
  const unreadNotifications = notifications.filter((n) => !n.read);

  if (unreadNotifications.length === 0) return null;

  const handleDismiss = async (id: string) => {
    try {
      await userApi.markNotificationRead(id);
      onDismiss(id);
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  };

  return (
    <div className="space-y-3 mb-6">
      {unreadNotifications.map((notification) => {
        const isApproved = notification.type === 'limit_request_approved';
        const isDenied = notification.type === 'limit_request_denied';
        const newLimit = notification.data?.new_limit as number | undefined;

        return (
          <div
            key={notification.id}
            className={`px-4 py-3 rounded-lg flex items-start justify-between gap-4 ${
              isApproved
                ? 'bg-green-500/10 border border-green-500/30'
                : isDenied
                ? 'bg-yellow-500/10 border border-yellow-500/30'
                : 'bg-blue-500/10 border border-blue-500/30'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className={`flex-shrink-0 mt-0.5 ${
                isApproved ? 'text-green-400' : isDenied ? 'text-yellow-400' : 'text-blue-400'
              }`}>
                {isApproved ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ) : isDenied ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div>
                <h4 className={`font-medium ${
                  isApproved ? 'text-green-400' : isDenied ? 'text-yellow-400' : 'text-blue-400'
                }`}>
                  {notification.title}
                </h4>
                <p className="text-sm text-pihole-text-muted mt-0.5">
                  {notification.message}
                </p>
                {isApproved && newLimit && (
                  <p className="text-sm text-green-400 mt-1">
                    New limit: <strong>{formatDomains(newLimit)}</strong> domains
                  </p>
                )}
              </div>
            </div>

            {/* Dismiss Button */}
            <button
              onClick={() => handleDismiss(notification.id)}
              className={`flex-shrink-0 p-1 rounded hover:bg-black/20 ${
                isApproved ? 'text-green-400' : isDenied ? 'text-yellow-400' : 'text-blue-400'
              }`}
              title="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
