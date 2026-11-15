import type { ReactNode } from 'react';
import {
  UNCATEGORISED_LIST,
  categoryLabel,
  describeProblem,
  type GroupedSources,
  type ParsedSource,
  type SourceEntry,
  type UnrecognisedLine,
} from '../../components/config/sourceLines';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { EmptyState } from '../../components/ui/States';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatInteger, pluralise } from '../../lib/format';
import type { SourceRowState } from './configFacts';

const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-4 gap-y-2 border-b border-border px-[18px] py-[11px] [contain-intrinsic-size:auto_60px] [content-visibility:auto] hover:bg-surface-hover narrow:grid-cols-[minmax(0,1fr)_auto] narrow:px-3';

function GroupHeading({ id, tone, children }: { id: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <h3
      id={id}
      className={
        tone === 'warn'
          ? 'flex items-center gap-2.5 border-b border-border bg-warn-soft px-[18px] py-2.5 text-xs font-medium text-warn narrow:px-3'
          : 'flex items-center gap-2.5 border-b border-border bg-surface-raised px-[18px] py-2.5 text-xs font-medium text-text-secondary narrow:px-3'
      }
    >
      {children}
    </h3>
  );
}

function RowState({ state }: { state: SourceRowState }) {
  if (state.kind === 'unsaved') {
    return (
      <StatusPill tone="info" icon="plus">
        Not saved yet
      </StatusPill>
    );
  }
  if (state.kind === 'failed') {
    return (
      <StatusPill tone="fail" icon="fail">
        Failed last build
      </StatusPill>
    );
  }
  if (state.kind === 'stale') {
    return (
      <StatusPill tone="warn" icon="warn">
        Older copy last build
      </StatusPill>
    );
  }
  if (state.kind === 'domains') {
    return (
      <span className="num text-[13px] whitespace-nowrap text-text-tertiary">
        {formatInteger(state.count)} domains
      </span>
    );
  }
  return null;
}

function RowActions({
  label,
  onEdit,
  editLabel = 'Edit',
  onRemove,
}: {
  label: string;
  onEdit: () => void;
  editLabel?: string;
  onRemove: () => void;
}) {
  return (
    <div className="flex gap-1 narrow:col-span-2 narrow:justify-end">
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`${editLabel} ${label}`}>
        {editLabel}
      </Button>
      <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${label}`}>
        Remove
      </Button>
    </div>
  );
}

function SourceRow({
  entry,
  state,
  onEdit,
  onRemove,
}: {
  entry: SourceEntry<ParsedSource>;
  state: SourceRowState;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { parsed } = entry;
  return (
    <li className={ROW}>
      <div className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{parsed.name}</span>
          {parsed.abp ? <StatusPill>abp</StatusPill> : null}
        </span>
        <span className="block truncate font-mono text-xs text-text-tertiary">{parsed.url}</span>
      </div>
      <div>
        <RowState state={state} />
      </div>
      <RowActions label={parsed.name} onEdit={onEdit} onRemove={onRemove} />
    </li>
  );
}

function AttentionRow({
  entry,
  onEdit,
  onShowInText,
  onRemove,
}: {
  entry: SourceEntry<ParsedSource | UnrecognisedLine>;
  onEdit: () => void;
  onShowInText: () => void;
  onRemove: () => void;
}) {
  const { parsed, lineNumber } = entry;
  const fixable = parsed.kind === 'source';
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 border-b border-border px-[18px] py-[11px] narrow:grid-cols-[minmax(0,1fr)] narrow:px-3">
      <div className="min-w-0">
        <span className="block font-mono text-xs break-all">{entry.line.raw.trim()}</span>
        <ul className="m-0 mt-1 list-none p-0 text-[13px] text-text-secondary">
          {parsed.problems.map((problem) => (
            <li key={problem} className="flex items-start gap-1.5">
              <Icon name="warn" size={13} className="mt-[3px] text-warn" />
              <span>
                Line {lineNumber}. {describeProblem(problem)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <RowActions
        label={`line ${lineNumber}`}
        editLabel={fixable ? 'Fix' : 'Show in text'}
        onEdit={fixable ? onEdit : onShowInText}
        onRemove={onRemove}
      />
    </li>
  );
}

export interface SourcesPanelProps {
  grouped: GroupedSources;
  rowState: (entry: SourceEntry<ParsedSource>) => SourceRowState;
  commentCount: number;
  onEdit: (lineId: number) => void;
  onRemove: (lineId: number) => void;
  onShowInText: (lineNumber: number) => void;
  emptyAction: ReactNode;
}

export function SourcesPanel({
  grouped,
  rowState,
  commentCount,
  onEdit,
  onRemove,
  onShowInText,
  emptyAction,
}: SourcesPanelProps) {
  const { groups, uncategorised, attention } = grouped;
  if (groups.length === 0 && uncategorised.length === 0 && attention.length === 0) {
    return (
      <EmptyState title="No sources yet" action={emptyAction}>
        Add lists from the library or by their address. A build combines them into your own
        blocklist.
      </EmptyState>
    );
  }
  return (
    <div className="[&>section:last-child_li:last-child]:border-b-0">
      {attention.length > 0 ? (
        <section aria-labelledby="sources-attention">
          <GroupHeading id="sources-attention" tone="warn">
            <Icon name="warn" size={14} />
            Needs attention
            <span className="font-normal">{pluralise(attention.length, 'line')}</span>
          </GroupHeading>
          <ul className="m-0 list-none p-0">
            {attention.map((entry) => (
              <AttentionRow
                key={entry.line.id}
                entry={entry}
                onEdit={() => onEdit(entry.line.id)}
                onShowInText={() => onShowInText(entry.lineNumber)}
                onRemove={() => onRemove(entry.line.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {groups.map((group) => {
        const headingId = `sources-${group.category}`;
        return (
          <section key={group.category} aria-labelledby={headingId}>
            <GroupHeading id={headingId}>
              {categoryLabel(group.category)}
              <span className="font-normal text-text-tertiary">
                {pluralise(group.entries.length, 'source')}
              </span>
            </GroupHeading>
            <ul className="m-0 list-none p-0">
              {group.entries.map((entry) => (
                <SourceRow
                  key={entry.line.id}
                  entry={entry}
                  state={rowState(entry)}
                  onEdit={() => onEdit(entry.line.id)}
                  onRemove={() => onRemove(entry.line.id)}
                />
              ))}
            </ul>
          </section>
        );
      })}
      {uncategorised.length > 0 ? (
        <section aria-labelledby="sources-uncategorised">
          <GroupHeading id="sources-uncategorised">
            No category
            <span className="font-normal text-text-tertiary">
              {pluralise(uncategorised.length, 'source')}, published in a separate list named{' '}
              <span translate="no">{UNCATEGORISED_LIST}</span>
            </span>
          </GroupHeading>
          <ul className="m-0 list-none p-0">
            {uncategorised.map((entry) => (
              <SourceRow
                key={entry.line.id}
                entry={entry}
                state={rowState(entry)}
                onEdit={() => onEdit(entry.line.id)}
                onRemove={() => onRemove(entry.line.id)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {commentCount > 0 ? (
        <p className="px-[18px] py-2.5 text-xs text-text-tertiary narrow:px-3">
          {pluralise(commentCount, 'comment line')} in the file {commentCount === 1 ? 'is' : 'are'}{' '}
          kept as written. Switch to Text to read or change {commentCount === 1 ? 'it' : 'them'}.
        </p>
      ) : null}
    </div>
  );
}
