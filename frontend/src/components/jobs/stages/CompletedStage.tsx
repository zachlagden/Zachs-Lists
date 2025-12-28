import type { Job, OutputFile, SourceProgress, WhitelistProgress } from '../../../types';

interface CompletedStageProps {
  job: Job;
  sources: SourceProgress[];
  whitelist: WhitelistProgress | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export default function CompletedStage({ job, sources, whitelist }: CompletedStageProps) {
  const result = job.result;
  const isSkipped = job.status === 'skipped';
  const isFailed = job.status === 'failed';

  // Calculate duration
  const duration =
    job.started_at && job.completed_at
      ? new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()
      : null;

  // Count source stats
  const failedSources = sources.filter((s) => s.status === 'failed').length;
  const cachedSources = sources.filter((s) => s.cache_hit === true).length;

  // Skipped message
  if (isSkipped) {
    return (
      <div className="space-y-4">
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-6 text-center">
          <svg
            className="w-12 h-12 text-yellow-400 mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 5l7 7-7 7M5 5l7 7-7 7"
            />
          </svg>
          <h3 className="text-lg font-semibold text-yellow-400 mb-2">Job Skipped</h3>
          <p className="text-pihole-text-muted">
            {result?.skip_reason || 'Another job was already running'}
          </p>
        </div>
      </div>
    );
  }

  // Failed message
  if (isFailed && !result) {
    return (
      <div className="space-y-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6 text-center">
          <svg
            className="w-12 h-12 text-red-400 mx-auto mb-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-red-400 mb-2">Job Failed</h3>
          <p className="text-pihole-text-muted">
            This job failed without producing results. Check your configuration and try again.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Success/Failure header */}
      <div
        className={`rounded-lg p-4 ${
          isFailed ? 'bg-red-500/10 border border-red-500/30' : 'bg-green-500/10 border border-green-500/30'
        }`}
      >
        <div className="flex items-center gap-3">
          {isFailed ? (
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <div>
            <h3 className={`font-semibold ${isFailed ? 'text-red-400' : 'text-green-400'}`}>
              {isFailed ? 'Build Completed with Errors' : 'Build Completed Successfully'}
            </h3>
            {duration && (
              <p className="text-sm text-pihole-text-muted">Completed in {formatDuration(duration)}</p>
            )}
          </div>
        </div>
      </div>

      {/* Copied build info banner */}
      {result?.copied_from && (
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h4 className="font-medium text-blue-400">Build Copied</h4>
              <p className="text-sm text-pihole-text-muted mt-1">
                Your config matches {result.copied_from === '__default__' ? 'the default blocklist' : `@${result.copied_from}`}'s build.
                Output files were copied instead of rebuilding. Timing data and stage history are from the original build.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Stats grid */}
      {result && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-pihole-darkest rounded-lg p-3">
            <div className="text-xs text-pihole-text-muted mb-1">Sources</div>
            <div className="text-xl font-semibold text-pihole-text">
              {result.sources_processed}
              {result.sources_failed > 0 && (
                <span className="text-sm text-red-400 ml-1">(-{result.sources_failed})</span>
              )}
            </div>
            {cachedSources > 0 && (
              <div className="text-xs text-green-400">{cachedSources} cached</div>
            )}
          </div>
          <div className="bg-pihole-darkest rounded-lg p-3">
            <div className="text-xs text-pihole-text-muted mb-1">Total Domains</div>
            <div className="text-xl font-semibold text-pihole-text">
              {result.total_domains?.toLocaleString()}
            </div>
          </div>
          <div className="bg-pihole-darkest rounded-lg p-3">
            <div className="text-xs text-pihole-text-muted mb-1">Unique Domains</div>
            <div className="text-xl font-semibold text-pihole-text">
              {result.unique_domains?.toLocaleString()}
            </div>
          </div>
          <div className="bg-pihole-darkest rounded-lg p-3">
            <div className="text-xs text-pihole-text-muted mb-1">Whitelisted</div>
            <div className="text-xl font-semibold text-red-400">
              -{result.whitelisted_removed?.toLocaleString() || 0}
            </div>
          </div>
        </div>
      )}

      {/* Whitelist breakdown */}
      {whitelist && whitelist.patterns.length > 0 && (
        <div className="bg-pihole-darkest rounded-lg p-4">
          <h4 className="font-semibold text-pihole-text mb-3">Whitelist Breakdown</h4>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {[...whitelist.patterns]
              .sort((a, b) => b.match_count - a.match_count)
              .slice(0, 10)
              .map((pattern, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <code className="text-pihole-text-muted">{pattern.pattern}</code>
                  <span className="text-red-400">-{pattern.match_count.toLocaleString()}</span>
                </div>
              ))}
            {whitelist.patterns.length > 10 && (
              <div className="text-xs text-pihole-text-muted">
                +{whitelist.patterns.length - 10} more patterns
              </div>
            )}
          </div>
        </div>
      )}

      {/* Output files */}
      {result?.output_files && result.output_files.length > 0 && (
        <div className="bg-pihole-darkest rounded-lg p-4">
          <h4 className="font-semibold text-pihole-text mb-3">Output Files</h4>
          <div className="space-y-2">
            {result.output_files.map((file: OutputFile, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between text-sm bg-pihole-darker px-3 py-2 rounded border border-pihole-border/30"
              >
                <div className="flex items-center gap-2">
                  <svg
                    className="w-4 h-4 text-pihole-text-muted"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                  <span className="text-pihole-text">{file.name}</span>
                  <span className="text-xs text-pihole-text-muted bg-pihole-border/50 px-1.5 py-0.5 rounded">
                    {file.format}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-pihole-text-muted">
                  <span>{file.domain_count?.toLocaleString()} domains</span>
                  <span>{formatBytes(file.size_bytes)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Failed sources */}
      {failedSources > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <h4 className="font-semibold text-red-400 mb-3">Failed Sources ({failedSources})</h4>
          <div className="space-y-2 max-h-[200px] overflow-y-auto">
            {sources
              .filter((s) => s.status === 'failed')
              .map((source) => (
                <div key={source.id} className="text-sm">
                  <div className="font-medium text-pihole-text">{source.name}</div>
                  {source.error && <div className="text-red-400 text-xs">{source.error}</div>}
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Errors */}
      {result?.errors && result.errors.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
          <h4 className="font-semibold text-red-400 mb-3">Errors</h4>
          <div className="space-y-2">
            {result.errors.map((error: string, idx: number) => (
              <div key={idx} className="text-sm text-red-400">
                {error}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Timestamps */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-pihole-text-muted mb-1">Created</div>
          <div className="text-pihole-text">{new Date(job.created_at).toLocaleString()}</div>
        </div>
        {job.started_at && (
          <div>
            <div className="text-xs text-pihole-text-muted mb-1">Started</div>
            <div className="text-pihole-text">{new Date(job.started_at).toLocaleString()}</div>
          </div>
        )}
        {job.completed_at && (
          <div>
            <div className="text-xs text-pihole-text-muted mb-1">Completed</div>
            <div className="text-pihole-text">{new Date(job.completed_at).toLocaleString()}</div>
          </div>
        )}
      </div>
    </div>
  );
}
