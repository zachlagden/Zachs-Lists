import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminKeys, deleteLibraryEntry, libraryQuery, type LibraryEntry } from '../../../api/admin';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Field, Input, Select } from '../../../components/ui/Field';
import { LoadingRegion, PageHeader, Skeleton } from '../../../components/ui/Layout';
import { StatusPill } from '../../../components/ui/StatusPill';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../../components/ui/Table';
import { showToast } from '../../../components/ui/toasts';
import { cn } from '../../../lib/cn';
import { formatInteger, pluralise } from '../../../lib/format';
import { ActionDialog } from '../shared/ActionDialog';
import { choiceFromSearch } from '../shared/urlState';
import { useUrlState, useUrlText } from '../shared/useUrlState';
import { LibraryEntryDialog } from './LibraryEntryDialog';
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  categoryLabel,
  filterLibrary,
  groupByCategory,
  strictnessLabel,
} from './libraryFacts';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';

const CATEGORY_CHOICES = ['all', ...CATEGORY_ORDER] as const;
const COLUMN_COUNT = 5;

type Editing = { entry: LibraryEntry | null };

function DeleteEntryDialog({ entry, onClose }: { entry: LibraryEntry; onClose: () => void }) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title={`Delete ${entry.name}?`}
      confirmLabel="Delete the source"
      destructive
      run={() => deleteLibraryEntry(entry.id)}
      onDone={() => {
        showToast('ok', `${entry.name} is deleted from the library.`);
        void client.invalidateQueries({ queryKey: adminKeys.library() });
      }}
      onClose={onClose}
      failureTitle="The source was not deleted"
      fallback="Try again in a moment."
    >
      <p>
        The source is no longer offered in the library. Accounts that already use it keep it in
        their configuration.
      </p>
    </ActionDialog>
  );
}

export default function LibraryPage() {
  useDocumentMeta(adminTitle('Source library'));
  const url = useUrlState();
  const { params, update } = url;
  const [query, setQuery] = useUrlText(url, 'q');
  const library = useQuery(libraryQuery());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<LibraryEntry | null>(null);

  const category = choiceFromSearch(params, 'category', CATEGORY_CHOICES, 'all');
  const filtered = query !== '' || category !== 'all';
  const all = library.data?.library ?? [];
  const groups = groupByCategory(filterLibrary(all, query, category));
  const shownCount = groups.reduce((sum, group) => sum + group.entries.length, 0);

  return (
    <>
      <PageHeader
        title="Source library"
        description="The sources every account can pick from when it builds its configuration."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing({ entry: null })}>
            Add a source
          </Button>
        }
      />
      <Card as="section" aria-label="Library sources">
        <div className="grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-3 border-b border-border p-[18px] narrow:grid-cols-[minmax(0,1fr)] narrow:p-3">
          <Field label="Search by name, address or description">
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ads"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Category">
            <Select
              value={category}
              onChange={(event) =>
                update({ category: event.target.value === 'all' ? null : event.target.value })
              }
            >
              <option value="all">Every category</option>
              {CATEGORY_ORDER.map((option) => (
                <option key={option} value={option}>
                  {CATEGORY_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {library.data ? (
          groups.length === 0 ? (
            <EmptyState
              title={filtered ? 'No source matches these filters' : 'The library is empty'}
              headingLevel="h2"
              action={
                filtered ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setQuery('');
                      update({ category: null });
                    }}
                  >
                    Clear the filters
                  </Button>
                ) : (
                  <Button size="sm" icon="plus" onClick={() => setEditing({ entry: null })}>
                    Add a source
                  </Button>
                )
              }
            >
              {filtered
                ? 'Search looks in the name, the address and the description.'
                : 'Add a source to offer it to every account.'}
            </EmptyState>
          ) : (
            <>
              <p
                role="status"
                className="num border-b border-border px-[18px] py-2.5 text-[13px] text-text-secondary narrow:px-3"
              >
                {filtered
                  ? `${pluralise(shownCount, 'source')} of ${formatInteger(all.length)} match.`
                  : `${pluralise(all.length, 'source')}.`}
              </p>
              <Table>
                <caption className="sr-only">Library sources grouped by category</caption>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Source</TableHeaderCell>
                    <TableHeaderCell hideOnNarrow>Recommended</TableHeaderCell>
                    <TableHeaderCell align="right" hideOnNarrow>
                      Strictness
                    </TableHeaderCell>
                    <TableHeaderCell align="right">Domains</TableHeaderCell>
                    <TableHeaderCell align="right" hideOnNarrow>
                      <span className="sr-only">Actions</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                {groups.map((group, groupIndex) => (
                  <TableBody key={group.category}>
                    <tr>
                      <th
                        scope="rowgroup"
                        colSpan={COLUMN_COUNT}
                        className={cn(
                          'border-b border-border bg-surface-raised px-[18px] py-1.5 text-left text-xs font-medium text-text-secondary narrow:px-3',
                          groupIndex > 0 && 'border-t',
                        )}
                      >
                        {categoryLabel(group.category)}, {pluralise(group.entries.length, 'source')}
                      </th>
                    </tr>
                    {group.entries.map((entry) => {
                      const actions = (
                        <>
                          <Button
                            size="sm"
                            onClick={() => setEditing({ entry })}
                            aria-label={`Edit ${entry.name}`}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            icon="trash"
                            onClick={() => setDeleting(entry)}
                            aria-label={`Delete ${entry.name}`}
                          >
                            Delete
                          </Button>
                        </>
                      );
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <span className="font-medium break-words">{entry.name}</span>
                            <span className="block font-mono text-xs break-all text-text-tertiary">
                              {entry.url}
                            </span>
                            {entry.description ? (
                              <span className="block max-w-[62ch] text-[13px] break-words text-text-secondary">
                                {entry.description}
                              </span>
                            ) : null}
                            <span className="mt-2 hidden flex-wrap gap-2 narrow:flex">
                              {actions}
                            </span>
                          </TableCell>
                          <TableCell hideOnNarrow>
                            {entry.recommended ? (
                              <StatusPill tone="ok" icon="check">
                                Recommended
                              </StatusPill>
                            ) : (
                              <StatusPill icon="dash">Not recommended</StatusPill>
                            )}
                          </TableCell>
                          <TableCell align="right" hideOnNarrow className="whitespace-nowrap">
                            {strictnessLabel(entry.aggressiveness)}
                          </TableCell>
                          <TableCell align="right">{formatInteger(entry.domain_count)}</TableCell>
                          <TableCell align="right" hideOnNarrow>
                            <span className="inline-flex justify-end gap-2">{actions}</span>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                ))}
              </Table>
            </>
          )
        ) : library.isError ? (
          <ErrorState
            title="The library could not be loaded"
            headingLevel="h2"
            error={library.error}
            onRetry={() => void library.refetch()}
            retrying={library.isFetching}
          />
        ) : (
          <LoadingRegion label="Loading the library…" className="grid gap-3 p-[18px]">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </LoadingRegion>
        )}
      </Card>
      {editing && library.data ? (
        <LibraryEntryDialog
          key={editing.entry?.id ?? 'new'}
          entry={editing.entry}
          categories={CATEGORY_ORDER.filter((option) => library.data.categories.includes(option))}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {deleting ? <DeleteEntryDialog entry={deleting} onClose={() => setDeleting(null)} /> : null}
    </>
  );
}
