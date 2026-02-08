import type { Job, JobStatus } from '../../types';

interface JobListProps {
  jobs: Job[];
  selectedJobId: string | null;
  onSelectJob: (job: Job) => void;
  showUsername?: boolean; // Show username for admin view
}

const statusColors: Record<JobStatus, string> = {
  queued: 'bg-yellow-500/20 text-yellow-400',
  processing: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  skipped: 'bg-gray-500/20 text-gray-400',
};

function JobStatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`px-2 py-0.5 text-xs rounded font-medium ${statusColors[status]}`}>
      {status === 'processing' && (
        <span className="inline-block w-1.5 h-1.5 bg-current rounded-full mr-1.5 animate-pulse" />
      )}
      {status}
    </span>
  );
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  if (diffSec < 60) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString();
}

export default function JobList({
  jobs,
  selectedJobId,
  onSelectJob,
  showUsername = false,
}: JobListProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center text-pihole-text-muted py-8">
        <svg
          className="w-12 h-12 mx-auto mb-3 text-pihole-border"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
          />
        </svg>
        <p>No jobs yet</p>
        <p className="text-xs mt-1">Trigger a build to see job history</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const isSelected = selectedJobId === job.job_id;
        const isActive = job.status === 'queued' || job.status === 'processing';

        return (
          <button
            key={job.job_id}
            onClick={() => onSelectJob(job)}
            className={`w-full text-left p-3 rounded-lg transition-all ${
              isSelected
                ? 'bg-pihole-accent/20 border border-pihole-accent shadow-lg shadow-pihole-accent/10'
                : 'bg-pihole-darkest hover:bg-pihole-border/50 border border-transparent'
            } ${isActive && !isSelected ? 'ring-1 ring-blue-500/30' : ''}`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="min-w-0">
                <span className="text-sm font-medium text-pihole-text capitalize">
                  {job.type} Build
                </span>
                {showUsername && (
                  <span className="text-xs text-pihole-text-muted ml-2">
                    {job.username || 'default'}
                  </span>
                )}
              </div>
              <JobStatusBadge status={job.status} />
            </div>

            <div className="flex items-center justify-between text-xs text-pihole-text-muted">
              <span>{formatRelativeTime(job.created_at)}</span>
              {job.progress && isActive && (
                <span className="text-pihole-accent">
                  {job.progress.stage !== 'queue' &&
                    `${job.progress.processed_sources}/${job.progress.total_sources}`}
                </span>
              )}
            </div>

            {/* Mini progress bar for active jobs */}
            {isActive && job.progress && job.progress.total_sources > 0 && (
              <div className="mt-2 h-1 bg-pihole-border rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    job.status === 'processing' ? 'bg-blue-500' : 'bg-yellow-500'
                  }`}
                  style={{
                    width: `${(job.progress.processed_sources / job.progress.total_sources) * 100}%`,
                  }}
                />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
