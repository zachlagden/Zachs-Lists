import type { FormatProgress, GenerationProgress } from '../../../types';
import ProgressBar from '../ProgressBar';

interface GenerationStageProps {
  generation: GenerationProgress | null;
  formats: Record<string, FormatProgress>;
}

const formatConfig: Record<string, { label: string; description: string; color: 'blue' | 'green' | 'yellow' }> = {
  hosts: {
    label: 'Hosts',
    description: '0.0.0.0 domain.com',
    color: 'blue',
  },
  plain: {
    label: 'Plain',
    description: 'domain.com',
    color: 'green',
  },
  adblock: {
    label: 'AdBlock',
    description: '||domain.com^',
    color: 'yellow',
  },
};

const statusLabels: Record<string, string> = {
  pending: 'Waiting...',
  generating: 'Generating...',
  compressing: 'Compressing...',
  completed: 'Complete',
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export default function GenerationStage({ generation, formats }: GenerationStageProps) {
  // Get formats from generation or direct formats prop
  const formatList = generation?.formats || Object.values(formats);

  if (formatList.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-pihole-accent border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-pihole-text-muted">Preparing format generation...</p>
      </div>
    );
  }

  const completedFormats = formatList.filter((f) => f.status === 'completed').length;
  const totalDomains = formatList[0]?.total_domains || 0;

  return (
    <div className="space-y-4">
      {/* Summary header */}
      <div className="bg-pihole-darkest rounded-lg p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-pihole-text">Generating Output Files</h3>
          <span className="text-sm text-pihole-text-muted">
            {completedFormats} / {formatList.length} formats
          </span>
        </div>
        <ProgressBar
          percent={(completedFormats / formatList.length) * 100}
          color="accent"
          size="md"
        />
        <div className="text-xs text-pihole-text-muted mt-2">
          {totalDomains.toLocaleString()} total domains
        </div>
      </div>

      {/* Format cards */}
      <div className="space-y-3">
        {formatList.map((format) => {
          const config = formatConfig[format.format] || {
            label: format.format,
            description: '',
            color: 'blue' as const,
          };
          const isActive = format.status === 'generating' || format.status === 'compressing';
          const isComplete = format.status === 'completed';

          return (
            <div
              key={format.format}
              className={`bg-pihole-darkest rounded-lg p-4 border transition-colors ${
                isActive
                  ? 'border-pihole-accent/50'
                  : isComplete
                  ? 'border-green-500/30'
                  : 'border-pihole-border/50'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <span className="font-medium text-pihole-text">{config.label}</span>
                    <code className="text-xs text-pihole-text-muted">{config.description}</code>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {isActive && (
                    <div className="w-4 h-4 border-2 border-pihole-accent border-t-transparent rounded-full animate-spin" />
                  )}
                  {isComplete && (
                    <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span
                    className={`text-sm ${
                      isComplete
                        ? 'text-green-400'
                        : isActive
                        ? 'text-pihole-accent'
                        : 'text-pihole-text-muted'
                    }`}
                  >
                    {statusLabels[format.status] || format.status}
                  </span>
                </div>
              </div>

              {/* Progress bar for active formats */}
              {isActive && (
                <div className="mb-2">
                  <ProgressBar
                    percent={format.percent}
                    color={config.color}
                    size="sm"
                    animated={format.status === 'generating'}
                  />
                  <div className="flex justify-between text-xs text-pihole-text-muted mt-1">
                    <span>
                      {format.domains_written.toLocaleString()} / {format.total_domains.toLocaleString()} domains
                    </span>
                    <span>{Math.round(format.percent)}%</span>
                  </div>
                </div>
              )}

              {/* File size info for completed formats */}
              {isComplete && (format.file_size || format.gz_size) && (
                <div className="flex gap-4 text-xs text-pihole-text-muted">
                  {format.file_size && (
                    <span>
                      Size: <span className="text-pihole-text">{formatBytes(format.file_size)}</span>
                    </span>
                  )}
                  {format.gz_size && (
                    <span>
                      Gzipped: <span className="text-pihole-text">{formatBytes(format.gz_size)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
