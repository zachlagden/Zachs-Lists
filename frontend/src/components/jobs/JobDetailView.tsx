import type { Job, SourceProgress, WhitelistProgress, FormatProgress, JobStatus } from '../../types';
import JobStageStepper from './JobStageStepper';
import QueueStage from './stages/QueueStage';
import DownloadingStage from './stages/DownloadingStage';
import WhitelistStage from './stages/WhitelistStage';
import GenerationStage from './stages/GenerationStage';
import CompletedStage from './stages/CompletedStage';

interface JobDetailViewProps {
  job: Job;
  sources: SourceProgress[];
  whitelist: WhitelistProgress | null;
  formats: Record<string, FormatProgress>;
  showUsername?: boolean;  // Show username for admin view
}

const statusColors: Record<JobStatus, string> = {
  queued: 'bg-yellow-500/20 text-yellow-400',
  processing: 'bg-blue-500/20 text-blue-400',
  completed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  skipped: 'bg-gray-500/20 text-gray-400',
};

export default function JobDetailView({ job, sources, whitelist, formats, showUsername = false }: JobDetailViewProps) {
  const stage = job.progress?.stage || 'queue';
  const isFinished = job.status === 'completed' || job.status === 'failed' || job.status === 'skipped';

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-pihole-text capitalize">
            {job.type} Build
            {showUsername && (
              <span className="text-pihole-text-muted font-normal ml-2">
                by {job.username || 'default'}
              </span>
            )}
          </h2>
          <p className="text-sm text-pihole-text-muted font-mono">
            {job.job_id}
          </p>
        </div>
        <span className={`px-3 py-1.5 text-sm rounded font-medium ${statusColors[job.status]}`}>
          {job.status === 'processing' && (
            <span className="inline-block w-2 h-2 bg-current rounded-full mr-2 animate-pulse" />
          )}
          {job.status}
        </span>
      </div>

      {/* Stage stepper */}
      <JobStageStepper stage={stage} status={job.status} />

      {/* Stage content */}
      <div className="min-h-[300px]">
        {!isFinished && stage === 'queue' && (
          <QueueStage progress={job.progress} queueInfo={job.queue_info} />
        )}

        {!isFinished && stage === 'downloading' && (
          <DownloadingStage progress={job.progress} sources={sources} />
        )}

        {!isFinished && stage === 'whitelist' && (
          <WhitelistStage whitelist={whitelist} />
        )}

        {!isFinished && stage === 'generation' && (
          <GenerationStage generation={job.progress.generation} formats={formats} />
        )}

        {(isFinished || stage === 'completed') && (
          <CompletedStage job={job} sources={sources} whitelist={whitelist} />
        )}
      </div>
    </div>
  );
}
