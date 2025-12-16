import type { WhitelistProgress } from '../../../types';
import ProgressBar from '../ProgressBar';

interface WhitelistStageProps {
  whitelist: WhitelistProgress | null;
}

const patternTypeLabels: Record<string, string> = {
  exact: 'Exact',
  wildcard: 'Wildcard',
  regex: 'Regex',
  subdomain: 'Subdomain',
};

const patternTypeColors: Record<string, string> = {
  exact: 'bg-blue-500/20 text-blue-400',
  wildcard: 'bg-purple-500/20 text-purple-400',
  regex: 'bg-orange-500/20 text-orange-400',
  subdomain: 'bg-teal-500/20 text-teal-400',
};

export default function WhitelistStage({ whitelist }: WhitelistStageProps) {
  if (!whitelist) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-pihole-accent border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-pihole-text-muted">Initializing whitelist processing...</p>
      </div>
    );
  }

  if (whitelist.processing) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-pihole-accent border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-pihole-text">Applying whitelist patterns...</p>
        <p className="text-sm text-pihole-text-muted mt-2">
          {whitelist.domains_before.toLocaleString()} domains to check
        </p>
      </div>
    );
  }

  const removalPercent =
    whitelist.domains_before > 0
      ? (whitelist.total_removed / whitelist.domains_before) * 100
      : 0;

  // Sort patterns by match count descending
  const sortedPatterns = [...whitelist.patterns].sort((a, b) => b.match_count - a.match_count);

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="bg-pihole-darkest rounded-lg p-4">
        <h3 className="font-semibold text-pihole-text mb-3">Whitelist Summary</h3>

        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <div className="text-xs text-pihole-text-muted mb-1">Before</div>
            <div className="text-lg font-semibold text-pihole-text">
              {whitelist.domains_before.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-pihole-text-muted mb-1">Removed</div>
            <div className="text-lg font-semibold text-red-400">
              -{whitelist.total_removed.toLocaleString()}
            </div>
          </div>
          <div>
            <div className="text-xs text-pihole-text-muted mb-1">After</div>
            <div className="text-lg font-semibold text-green-400">
              {whitelist.domains_after.toLocaleString()}
            </div>
          </div>
        </div>

        <ProgressBar percent={100 - removalPercent} color="green" size="md" showPercent />
        <div className="text-xs text-pihole-text-muted mt-1 text-right">
          {removalPercent.toFixed(1)}% whitelisted
        </div>
      </div>

      {/* Pattern breakdown */}
      {sortedPatterns.length > 0 && (
        <div className="bg-pihole-darkest rounded-lg p-4">
          <h3 className="font-semibold text-pihole-text mb-3">
            Pattern Breakdown ({sortedPatterns.length} pattern{sortedPatterns.length !== 1 ? 's' : ''})
          </h3>

          <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
            {sortedPatterns.map((pattern, idx) => (
              <div key={idx} className="bg-pihole-darker rounded-lg p-3 border border-pihole-border/50">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <code className="text-sm text-pihole-text font-mono bg-pihole-border/30 px-2 py-0.5 rounded">
                      {pattern.pattern}
                    </code>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        patternTypeColors[pattern.pattern_type] || 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {patternTypeLabels[pattern.pattern_type] || pattern.pattern_type}
                    </span>
                  </div>
                  <span className="text-sm font-medium text-red-400">
                    -{pattern.match_count.toLocaleString()}
                  </span>
                </div>

                {/* Sample matches */}
                {pattern.samples.length > 0 && (
                  <div className="text-xs text-pihole-text-muted">
                    <span className="text-pihole-text-muted">Matched: </span>
                    {pattern.samples.slice(0, 3).map((sample, sIdx) => (
                      <span key={sIdx}>
                        <code className="text-pihole-text">{sample}</code>
                        {sIdx < Math.min(pattern.samples.length - 1, 2) && ', '}
                      </span>
                    ))}
                    {pattern.samples.length > 3 && (
                      <span className="text-pihole-text-muted"> +{pattern.samples.length - 3} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {sortedPatterns.length === 0 && whitelist.total_removed === 0 && (
        <div className="text-center py-4 text-pihole-text-muted">
          No domains matched whitelist patterns
        </div>
      )}
    </div>
  );
}
