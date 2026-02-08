import type { JobStage, JobStatus, StageSnapshot } from '../../types';

interface JobStageStepperProps {
  stage: JobStage;
  status: JobStatus;
  stageSnapshots?: Record<string, StageSnapshot>;
  selectedStage?: string | null;
  onStageClick?: (stage: string) => void;
}

const stages: { key: JobStage; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'downloading', label: 'Downloading' },
  { key: 'whitelist', label: 'Whitelist' },
  { key: 'generation', label: 'Generation' },
  { key: 'completed', label: 'Complete' },
];

export default function JobStageStepper({
  stage,
  status,
  stageSnapshots,
  selectedStage,
  onStageClick,
}: JobStageStepperProps) {
  const currentIndex = stages.findIndex((s) => s.key === stage);
  const isSkipped = status === 'skipped';
  const isFailed = status === 'failed';

  return (
    <div className="flex items-center justify-between mb-6">
      {stages.map((s, index) => {
        const isCompleted =
          index < currentIndex || (index === currentIndex && stage === 'completed');
        const isCurrent = index === currentIndex && stage !== 'completed';
        const hasSnapshot = s.key !== 'queue' && s.key !== 'completed' && stageSnapshots?.[s.key];
        const isSelected = selectedStage === s.key;
        const isClickable = isCompleted && hasSnapshot && onStageClick;

        let stageStatus: 'completed' | 'current' | 'pending' | 'failed' | 'skipped' = 'pending';
        if (isCompleted) stageStatus = 'completed';
        else if (isCurrent && isFailed) stageStatus = 'failed';
        else if (isCurrent && isSkipped) stageStatus = 'skipped';
        else if (isCurrent) stageStatus = 'current';

        const handleClick = () => {
          if (isClickable) {
            onStageClick(s.key);
          }
        };

        return (
          <div key={s.key} className="flex-1 flex flex-col items-center relative">
            {/* Connector line */}
            {index > 0 && (
              <div
                className={`absolute top-3 -left-1/2 w-full h-0.5 ${
                  isCompleted ? 'bg-green-500' : 'bg-pihole-border'
                }`}
                style={{ zIndex: 0 }}
              />
            )}

            {/* Circle indicator */}
            <button
              type="button"
              onClick={handleClick}
              disabled={!isClickable}
              className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                stageStatus === 'completed'
                  ? 'bg-green-500 text-white'
                  : stageStatus === 'current'
                    ? 'bg-pihole-accent text-white animate-pulse'
                    : stageStatus === 'failed'
                      ? 'bg-red-500 text-white'
                      : stageStatus === 'skipped'
                        ? 'bg-yellow-500 text-white'
                        : 'bg-pihole-border text-pihole-text-muted'
              } ${isClickable ? 'cursor-pointer hover:ring-2 hover:ring-blue-400 hover:ring-offset-2 hover:ring-offset-pihole-surface' : ''} ${
                isSelected ? 'ring-2 ring-blue-500 ring-offset-2 ring-offset-pihole-surface' : ''
              }`}
            >
              {stageStatus === 'completed' ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              ) : stageStatus === 'failed' ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              ) : stageStatus === 'skipped' ? (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 5l7 7-7 7M5 5l7 7-7 7"
                  />
                </svg>
              ) : (
                index + 1
              )}
            </button>

            {/* Label */}
            <div
              className={`mt-2 text-xs font-medium ${
                isSelected
                  ? 'text-blue-400'
                  : stageStatus === 'completed'
                    ? 'text-green-400'
                    : stageStatus === 'current'
                      ? 'text-pihole-accent'
                      : stageStatus === 'failed'
                        ? 'text-red-400'
                        : stageStatus === 'skipped'
                          ? 'text-yellow-400'
                          : 'text-pihole-text-muted'
              }`}
            >
              {s.label}
              {isClickable && <span className="ml-1 text-blue-400 opacity-60">(click)</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
