import { useEffect, useState } from 'react';
import type { EnhancedJobProgress, QueueInfo } from '../../../types';

interface QueueStageProps {
  progress: EnhancedJobProgress;
  queueInfo?: QueueInfo;
}

export default function QueueStage({ progress, queueInfo }: QueueStageProps) {
  const [countdown, setCountdown] = useState<number | null>(null);

  useEffect(() => {
    if (progress.queue_delay_remaining_ms !== null && progress.queue_delay_remaining_ms > 0) {
      setCountdown(Math.ceil(progress.queue_delay_remaining_ms / 1000));
    } else {
      setCountdown(null);
    }
  }, [progress.queue_delay_remaining_ms]);

  // Local countdown timer
  useEffect(() => {
    if (countdown === null || countdown <= 0) return;

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev === null || prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [countdown]);

  // Use queue_info from WebSocket if available, otherwise fall back to progress
  const position = queueInfo?.position ?? progress.queue_position ?? 0;
  const totalQueued = queueInfo?.total_queued ?? 0;
  const activeWorkers = queueInfo?.active_workers ?? 0;
  const jobsProcessing = queueInfo?.jobs_processing ?? 0;

  return (
    <div className="flex flex-col items-center justify-center py-12">
      {/* Queue position indicator */}
      <div className="relative w-32 h-32 mb-6">
        <svg className="w-full h-full transform -rotate-90">
          <circle
            cx="64"
            cy="64"
            r="56"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            className="text-pihole-border"
          />
          {position > 0 && totalQueued > 0 && (
            <circle
              cx="64"
              cy="64"
              r="56"
              fill="none"
              stroke="currentColor"
              strokeWidth="8"
              strokeDasharray={2 * Math.PI * 56}
              strokeDashoffset={2 * Math.PI * 56 * (position / totalQueued)}
              strokeLinecap="round"
              className="text-pihole-accent transition-all duration-500"
            />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-pihole-text">
            {position > 0 ? `#${position}` : '...'}
          </span>
          {totalQueued > 0 && (
            <span className="text-xs text-pihole-text-muted">of {totalQueued}</span>
          )}
        </div>
      </div>

      <h3 className="text-lg font-semibold text-pihole-text mb-2">Queued</h3>

      {position > 0 ? (
        <p className="text-pihole-text-muted text-center">
          Position <span className="text-pihole-accent font-medium">{position}</span>
          {totalQueued > 0 && <span> of {totalQueued} in queue</span>}
        </p>
      ) : countdown !== null && countdown > 0 ? (
        <p className="text-pihole-text-muted text-center">
          Starting in <span className="text-pihole-accent font-medium">{countdown}</span> second{countdown !== 1 ? 's' : ''}...
        </p>
      ) : (
        <p className="text-pihole-text-muted text-center">Preparing to start...</p>
      )}

      {/* Worker stats */}
      {(activeWorkers > 0 || jobsProcessing > 0) && (
        <div className="mt-4 flex items-center gap-4 text-sm">
          {activeWorkers > 0 && (
            <div className="flex items-center gap-1.5 text-pihole-text-muted">
              <svg className="w-4 h-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <span>
                <span className="text-pihole-text font-medium">{activeWorkers}</span> worker{activeWorkers !== 1 ? 's' : ''} active
              </span>
            </div>
          )}
          {jobsProcessing > 0 && (
            <div className="flex items-center gap-1.5 text-pihole-text-muted">
              <svg className="w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>
                <span className="text-pihole-text font-medium">{jobsProcessing}</span> job{jobsProcessing !== 1 ? 's' : ''} processing
              </span>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex items-center gap-2 text-sm text-pihole-text-muted">
        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        <span>Waiting for available worker</span>
      </div>
    </div>
  );
}
