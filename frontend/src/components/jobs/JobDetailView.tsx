import { useState } from 'react';
import type { Job, SourceProgress, WhitelistProgress, FormatProgress, JobStatus, EnhancedJobProgress } from '../../types';
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

function formatSnapshotTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export default function JobDetailView({ job, sources, whitelist, formats, showUsername = false }: JobDetailViewProps) {
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  const stage = job.progress?.stage || 'queue';
  const isFinished = job.status === 'completed' || job.status === 'failed' || job.status === 'skipped';
  const stageSnapshots = job.progress?.stage_snapshots;

  // Get snapshot data if viewing a historical stage
  const selectedSnapshot = selectedStage ? stageSnapshots?.[selectedStage] : null;

  // Handler for stage clicks
  const handleStageClick = (clickedStage: string) => {
    // Toggle off if clicking the same stage
    if (selectedStage === clickedStage) {
      setSelectedStage(null);
    } else {
      setSelectedStage(clickedStage);
    }
  };

  // Render snapshot content based on selected stage
  const renderSnapshotContent = () => {
    if (!selectedSnapshot) return null;

    const data = selectedSnapshot.data as Record<string, unknown>;

    switch (selectedStage) {
      case 'downloading': {
        // Create a synthetic progress object for the snapshot
        const snapshotSources = (data.sources || []) as SourceProgress[];
        const snapshotProgress: EnhancedJobProgress = {
          stage: 'downloading',
          total_sources: (data.total_sources as number) || snapshotSources.length,
          processed_sources: (data.processed_sources as number) || snapshotSources.length,
          sources: snapshotSources,
          whitelist: null,
          generation: null,
          queue_position: null,
          queue_delay_remaining_ms: null,
          stage_started_at: null,
          current_step: 'downloading',
          current_source: null,
        };
        return <DownloadingStage progress={snapshotProgress} sources={snapshotSources} />;
      }
      case 'whitelist': {
        const whitelistData = data as unknown as WhitelistProgress;
        return <WhitelistStage whitelist={whitelistData} />;
      }
      case 'generation': {
        const generationData = data as { formats?: FormatProgress[]; current_format?: string | null };
        const generationProgress = {
          formats: generationData.formats || [],
          current_format: generationData.current_format || null,
        };
        return <GenerationStage generation={generationProgress} formats={formats} />;
      }
      default:
        return null;
    }
  };

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
      <JobStageStepper
        stage={stage}
        status={job.status}
        stageSnapshots={stageSnapshots}
        selectedStage={selectedStage}
        onStageClick={handleStageClick}
      />

      {/* Snapshot mode banner */}
      {selectedSnapshot && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-blue-400">
              Viewing snapshot from {formatSnapshotTime(selectedSnapshot.completed_at)}
            </span>
          </div>
          <button
            onClick={() => setSelectedStage(null)}
            className="text-sm text-blue-400 hover:text-blue-300 underline"
          >
            Back to current
          </button>
        </div>
      )}

      {/* Stage content */}
      <div className="min-h-[300px]">
        {/* Show snapshot content when viewing a historical stage */}
        {selectedSnapshot && renderSnapshotContent()}

        {/* Show live content when not viewing a snapshot */}
        {!selectedSnapshot && (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
