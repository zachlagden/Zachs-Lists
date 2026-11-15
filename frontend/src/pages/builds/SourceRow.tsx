import { Fragment, memo } from 'react';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { sourceOutcome, type SourceOutcome } from '../../components/ui/status';
import { SourceStatusPill } from '../../components/ui/StatusPill';
import { TableCell, TableRow } from '../../components/ui/Table';
import { cn } from '../../lib/cn';
import { formatBytes, formatInteger, formatSignedChange } from '../../lib/format';
import type { SourceProgress } from '../../types';
import { downloadRatio, nameParts, sourceNote } from './sourceFacts';
import { describeSeconds } from '../../lib/text';

function downloadText(source: SourceProgress, outcome: SourceOutcome): string {
  switch (outcome) {
    case 'pending':
      return '';
    case 'failed':
      return 'not downloaded';
    case 'stale':
      return 'older copy used';
    case 'cached':
      return 'not modified';
    case 'downloading':
      return source.bytes_total
        ? `${formatBytes(source.bytes_downloaded)} of ${formatBytes(source.bytes_total)}`
        : `${formatBytes(source.bytes_downloaded)} so far`;
    default: {
      const size = formatBytes(source.bytes_downloaded);
      return source.download_time_ms === null
        ? size
        : `${size} in ${describeSeconds(source.download_time_ms / 1000)}`;
    }
  }
}

function DownloadBar({ source, outcome }: { source: SourceProgress; outcome: SourceOutcome }) {
  const ratio = downloadRatio(source);
  if (outcome === 'downloading') {
    if (ratio === null) return null;
    return (
      <ProgressBar
        thin
        tone="info"
        value={ratio * 100}
        label={`${source.name} download`}
        valueText={downloadText(source, outcome)}
      />
    );
  }
  if (outcome === 'processing' || outcome === 'current') {
    return <ProgressBar thin tone="ok" value={100} label={`${source.name} download`} />;
  }
  return null;
}

function Domains({ source, outcome }: { source: SourceProgress; outcome: SourceOutcome }) {
  if (outcome === 'processing') {
    return (
      <span className="whitespace-nowrap">
        {source.domain_count ? `${formatInteger(source.domain_count)} ` : ''}
        <span className="text-text-tertiary">counting</span>
      </span>
    );
  }
  if (source.status !== 'completed' || source.domain_count === null) return null;
  return <>{formatInteger(source.domain_count)}</>;
}

function Change({ source }: { source: SourceProgress }) {
  if (source.status !== 'completed' || source.domain_change === null) return null;
  const change = source.domain_change;
  return (
    <span
      className={cn(
        change > 0 && 'text-ok',
        change < 0 && 'text-fail',
        change === 0 && 'text-text-tertiary',
      )}
    >
      {formatSignedChange(change)}
    </span>
  );
}

function BreakableName({ name }: { name: string }) {
  const parts = nameParts(name);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={index}>
          {index > 0 ? <wbr /> : null}
          {part}
        </Fragment>
      ))}
    </>
  );
}

export interface SourceRowProps {
  source: SourceProgress;
}

function SourceRowView({ source }: SourceRowProps) {
  const outcome = sourceOutcome(source);
  const note = sourceNote(source);
  const text = downloadText(source, outcome);
  const about = [source.category, ...source.detected_formats].filter(Boolean).join(' · ');
  return (
    <TableRow data-source-row={source.id}>
      <TableCell className="min-w-[8.5rem] break-words">
        <span className="block font-medium">
          <BreakableName name={source.name} />
        </span>
        {about ? <span className="block text-xs text-text-tertiary">{about}</span> : null}
        {note ? (
          <span
            className={cn(
              'mt-0.5 block max-w-[46ch] text-xs',
              note.tone === 'fail' ? 'text-fail' : 'text-warn',
            )}
          >
            {note.text}
          </span>
        ) : null}
        <span className="mt-1.5 hidden narrow:block">
          <DownloadBar source={source} outcome={outcome} />
          {text && !note ? (
            <span className="mt-1 block font-mono text-xs text-text-tertiary">{text}</span>
          ) : null}
        </span>
      </TableCell>
      <TableCell>
        <SourceStatusPill source={source} />
      </TableCell>
      <TableCell hideOnNarrow className="min-w-[170px]">
        <DownloadBar source={source} outcome={outcome} />
        {text ? (
          <span className="mt-1 block font-mono text-xs text-text-tertiary first:mt-0">{text}</span>
        ) : null}
      </TableCell>
      <TableCell align="right">
        <Domains source={source} outcome={outcome} />
      </TableCell>
      <TableCell align="right" hideOnNarrow>
        <Change source={source} />
      </TableCell>
    </TableRow>
  );
}

export const SourceRow = memo(SourceRowView);
