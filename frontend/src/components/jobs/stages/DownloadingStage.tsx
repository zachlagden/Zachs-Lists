import type { EnhancedJobProgress, SourceProgress, SourceStatus } from '../../../types';
import SourceProgressCard from '../SourceProgressCard';
import ProgressBar from '../ProgressBar';

interface DownloadingStageProps {
  progress: EnhancedJobProgress;
  sources: SourceProgress[];
}

// Sort order for source statuses
const statusOrder: Record<SourceStatus, number> = {
  downloading: 0,
  processing: 1,
  pending: 2,
  failed: 3,
  completed: 4,
};

function sortSources(sources: SourceProgress[]): SourceProgress[] {
  return [...sources].sort((a, b) => {
    const orderA = statusOrder[a.status] ?? 99;
    const orderB = statusOrder[b.status] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });
}

export default function DownloadingStage({ progress, sources }: DownloadingStageProps) {
  const sortedSources = sortSources(sources);
  const overallPercent =
    progress.total_sources > 0 ? (progress.processed_sources / progress.total_sources) * 100 : 0;

  // Count by status
  const statusCounts = sources.reduce(
    (acc, src) => {
      acc[src.status] = (acc[src.status] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const completedCount = statusCounts['completed'] || 0;
  const failedCount = statusCounts['failed'] || 0;
  const downloadingCount = statusCounts['downloading'] || 0;
  const processingCount = statusCounts['processing'] || 0;

  return (
    <div className="space-y-4">
      {/* Overall progress header */}
      <div className="bg-pihole-darkest rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-pihole-text">Downloading Sources</h3>
          <span className="text-sm text-pihole-text-muted">
            {progress.processed_sources} / {progress.total_sources}
          </span>
        </div>
        <ProgressBar percent={overallPercent} color="accent" size="md" />

        {/* Status summary */}
        <div className="flex flex-wrap gap-4 mt-3 text-xs">
          {downloadingCount > 0 && (
            <span className="flex items-center gap-1 text-blue-400">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              {downloadingCount} downloading
            </span>
          )}
          {processingCount > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <span className="w-2 h-2 rounded-full bg-yellow-500" />
              {processingCount} processing
            </span>
          )}
          {completedCount > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              {completedCount} completed
            </span>
          )}
          {failedCount > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              {failedCount} failed
            </span>
          )}
        </div>
      </div>

      {/* Source list */}
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-1">
        {sortedSources.map((source) => (
          <SourceProgressCard key={source.id} source={source} />
        ))}
      </div>

      {sortedSources.length === 0 && (
        <div className="text-center py-8 text-pihole-text-muted">Initializing sources...</div>
      )}
    </div>
  );
}
