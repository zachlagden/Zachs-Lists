import type { SourceProgress, SourceStatus } from '../../types';
import ProgressBar from './ProgressBar';

interface SourceProgressCardProps {
  source: SourceProgress;
}

const statusConfig: Record<SourceStatus, { color: string; label: string; bgColor: string }> = {
  pending: { color: 'text-pihole-text-muted', label: 'Pending', bgColor: 'bg-pihole-border/30' },
  downloading: { color: 'text-blue-400', label: 'Downloading', bgColor: 'bg-blue-500/10' },
  processing: { color: 'text-yellow-400', label: 'Processing', bgColor: 'bg-yellow-500/10' },
  completed: { color: 'text-green-400', label: 'Completed', bgColor: 'bg-green-500/10' },
  failed: { color: 'text-red-400', label: 'Failed', bgColor: 'bg-red-500/10' },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDomainChange(change: number | null | undefined): { text: string; color: string } | null {
  if (change == null || change === 0) return null;
  if (change > 0) {
    return { text: `+${change.toLocaleString()}`, color: 'text-green-400' };
  }
  return { text: change.toLocaleString(), color: 'text-red-400' };
}

export default function SourceProgressCard({ source }: SourceProgressCardProps) {
  const config = statusConfig[source.status];
  const domainChange = formatDomainChange(source.domain_change);
  const isDownloading = source.status === 'downloading';

  return (
    <div className={`rounded-lg p-3 ${config.bgColor} border border-pihole-border/50`}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-pihole-text text-sm truncate" title={source.name}>
            {source.name}
          </div>
          <div className="text-xs text-pihole-text-muted truncate" title={source.url}>
            {source.url}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {source.cache_hit != null && (
            <span
              className={`text-xs px-1.5 py-0.5 rounded ${
                source.cache_hit ? 'bg-green-500/20 text-green-400' : 'bg-blue-500/20 text-blue-400'
              }`}
            >
              {source.cache_hit ? 'Cached' : 'Fresh'}
            </span>
          )}
          <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
        </div>
      </div>

      {/* Download progress */}
      {isDownloading && source.bytes_total && source.bytes_total > 0 && (
        <div className="mb-2">
          <ProgressBar
            percent={source.download_percent || 0}
            color="blue"
            size="sm"
            animated
          />
          <div className="flex justify-between text-xs text-pihole-text-muted mt-1">
            <span>{formatBytes(source.bytes_downloaded)}</span>
            <span>{formatBytes(source.bytes_total)}</span>
          </div>
        </div>
      )}

      {/* Indeterminate progress for downloading without size */}
      {isDownloading && (!source.bytes_total || source.bytes_total === 0) && (
        <div className="mb-2">
          <div className="h-1 bg-pihole-border rounded-full overflow-hidden">
            <div className="h-full bg-blue-500 rounded-full animate-pulse w-1/2" />
          </div>
          {source.bytes_downloaded > 0 && (
            <div className="text-xs text-pihole-text-muted mt-1">
              {formatBytes(source.bytes_downloaded)} downloaded
            </div>
          )}
        </div>
      )}

      {/* Stats row for completed sources */}
      {source.status === 'completed' && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-pihole-text-muted">
          {source.domain_count != null && (
            <span>
              {source.domain_count.toLocaleString()} domains
              {domainChange && (
                <span className={`ml-1 ${domainChange.color}`}>({domainChange.text})</span>
              )}
            </span>
          )}
          {source.download_time_ms != null && (
            <span>{(source.download_time_ms / 1000).toFixed(1)}s</span>
          )}
          {source.bytes_downloaded > 0 && <span>{formatBytes(source.bytes_downloaded)}</span>}
        </div>
      )}

      {/* Warnings */}
      {source.warnings && source.warnings.length > 0 && (
        <div className="mt-2 space-y-1">
          {source.warnings.map((warning, idx) => (
            <div key={idx} className="text-xs text-yellow-400 bg-yellow-500/10 px-2 py-1 rounded">
              {warning}
            </div>
          ))}
        </div>
      )}

      {/* Error message */}
      {source.error && (
        <div className="mt-2 text-xs text-red-400 bg-red-500/10 px-2 py-1 rounded">
          {source.error}
        </div>
      )}
    </div>
  );
}
