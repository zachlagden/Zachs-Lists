import type { Announcement } from '../types';

interface AnnouncementBannerProps {
  announcements: Announcement[];
  onDismiss: (id: string) => void;
}

export default function AnnouncementBanner({ announcements, onDismiss }: AnnouncementBannerProps) {
  if (announcements.length === 0) return null;

  return (
    <div className="space-y-3 mb-6">
      {announcements.map((announcement) => {
        const isWarning = announcement.type === 'warning';
        const isCritical = announcement.type === 'critical';

        return (
          <div
            key={announcement.id}
            className={`px-4 py-3 rounded-lg flex items-start justify-between gap-4 ${
              isCritical
                ? 'bg-red-500/10 border border-red-500/30'
                : isWarning
                  ? 'bg-yellow-500/10 border border-yellow-500/30'
                  : 'bg-blue-500/10 border border-blue-500/30'
            }`}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div
                className={`flex-shrink-0 mt-0.5 ${
                  isCritical ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-blue-400'
                }`}
              >
                {isCritical ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                ) : isWarning ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                ) : (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
              </div>

              {/* Content */}
              <div>
                <h4
                  className={`font-medium ${
                    isCritical ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-blue-400'
                  }`}
                >
                  {announcement.title}
                </h4>
                <p className="text-sm text-pihole-text-muted mt-0.5">{announcement.message}</p>
              </div>
            </div>

            {/* Dismiss Button */}
            <button
              onClick={() => onDismiss(announcement.id)}
              className={`flex-shrink-0 p-1 rounded hover:bg-black/20 ${
                isCritical ? 'text-red-400' : isWarning ? 'text-yellow-400' : 'text-blue-400'
              }`}
              title="Dismiss"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
