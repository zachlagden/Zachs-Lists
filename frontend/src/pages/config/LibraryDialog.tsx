import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { libraryQuery, type LibraryEntry } from '../../api/config';
import {
  categoryLabel,
  planLibraryAdditions,
  type LibraryAdditions,
} from '../../components/config/sourceLines';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select } from '../../components/ui/Field';
import { LoadingRegion, Skeleton } from '../../components/ui/Layout';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatInteger, pluralise } from '../../lib/format';
import { filterLibrary } from './configFacts';

export interface LibraryDialogProps {
  categories: readonly string[];
  takenNames: ReadonlySet<string>;
  existingUrls: ReadonlySet<string>;
  remainingSlots: number;
  onAdd: (additions: LibraryAdditions) => void;
  onClose: () => void;
}

const ALL_CATEGORIES = '';

function LibraryRow({
  entry,
  present,
  selected,
  blocked,
  onToggle,
}: {
  entry: LibraryEntry;
  present: boolean;
  selected: boolean;
  blocked: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <label
        className={
          present || blocked
            ? 'flex gap-3 px-1 py-3 opacity-70'
            : 'flex cursor-pointer gap-3 px-1 py-3 hover:bg-surface-hover'
        }
      >
        <input
          type="checkbox"
          checked={selected}
          disabled={present || blocked}
          onChange={onToggle}
          className="mt-0.5 size-4 flex-none accent-(--accent-start)"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium break-words">{entry.name}</span>
            {present ? (
              <StatusPill tone="ok" icon="check">
                In your sources
              </StatusPill>
            ) : null}
            {entry.recommended ? <StatusPill tone="info">Recommended</StatusPill> : null}
          </span>
          {entry.description ? (
            <span className="mt-0.5 block text-[13px] break-words text-text-secondary">
              {entry.description}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-text-tertiary">
            {categoryLabel(entry.category)}
            {entry.domain_count > 0 ? ` · ${formatInteger(entry.domain_count)} domains` : ''}
          </span>
          <span className="block truncate font-mono text-xs text-text-tertiary">{entry.url}</span>
        </span>
      </label>
    </li>
  );
}

export function LibraryDialog({
  categories,
  takenNames,
  existingUrls,
  remainingSlots,
  onAdd,
  onClose,
}: LibraryDialogProps) {
  const library = useQuery(libraryQuery());
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());

  const entries = useMemo(
    () => (library.data ? Object.values(library.data.library).flat() : []),
    [library.data],
  );
  const shown = filterLibrary(entries, search, category);
  const full = selectedIds.size >= remainingSlots;

  const toggle = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = () => {
    const chosen = entries.filter((entry) => selectedIds.has(entry.id));
    onAdd(planLibraryAdditions(chosen, takenNames, existingUrls));
  };

  return (
    <Dialog
      open
      onClose={onClose}
      closeOnBackdropClick={selectedIds.size === 0}
      title="Add from the library"
      description="Lists this site already knows, with what each one blocks."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={selectedIds.size === 0} onClick={handleAdd}>
            {selectedIds.size === 0
              ? 'Add sources'
              : `Add ${pluralise(selectedIds.size, 'source')}`}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,180px)] gap-3 narrow:grid-cols-[minmax(0,1fr)]">
          <Field label="Search">
            <Input
              type="search"
              autoComplete="off"
              name="library-search"
              placeholder="Name, description or address…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
          <Field label="Category">
            <Select
              name="library-category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value={ALL_CATEGORIES}>All categories</option>
              {categories.map((option) => (
                <option key={option} value={option}>
                  {categoryLabel(option)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {remainingSlots <= 0 ? (
          <Alert tone="warn" live={false}>
            You have reached your source limit, so nothing can be added.
          </Alert>
        ) : full ? (
          <Alert tone="info" live={false}>
            You have chosen {pluralise(selectedIds.size, 'source')}, which fills your source limit.
          </Alert>
        ) : null}
        {library.isPending ? (
          <LoadingRegion label="Loading the library…" className="grid gap-3 py-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </LoadingRegion>
        ) : library.isError ? (
          <ErrorState
            compact
            title="The library could not be loaded"
            error={library.error}
            onRetry={() => void library.refetch()}
            retrying={library.isFetching}
          />
        ) : entries.length === 0 ? (
          <EmptyState compact title="The library is empty">
            Add a source by its address instead.
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState compact title="Nothing matches">
            Try another search or category.
          </EmptyState>
        ) : (
          <ul className="m-0 list-none p-0" aria-label="Library sources">
            {shown.map((entry) => {
              const selected = selectedIds.has(entry.id);
              return (
                <LibraryRow
                  key={entry.id}
                  entry={entry}
                  present={existingUrls.has(entry.url)}
                  selected={selected}
                  blocked={!selected && full}
                  onToggle={() => toggle(entry.id)}
                />
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
