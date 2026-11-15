import { focusFirstInvalid } from '../shared/fieldErrors';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  addFeaturedList,
  moveFeaturedList,
  adminFeaturedListsQuery,
  adminKeys,
  removeFeaturedList,
  type AdminFeaturedResponse,
} from '../../../api/admin';
import { listsKeys } from '../../../api/lists';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { Dialog } from '../../../components/ui/Dialog';
import { Field, Input, Textarea } from '../../../components/ui/Field';
import { LoadingRegion, PageHeader, Skeleton } from '../../../components/ui/Layout';
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
import { formatInteger } from '../../../lib/format';
import type { FeaturedList } from '../../../types';
import { ActionDialog } from '../shared/ActionDialog';
import {
  MAX_FEATURED_DESCRIPTION_LENGTH,
  MAX_FEATURED_NAME_LENGTH,
  addFeaturedFailure,
  draftErrors,
  planFeaturedMove,
  type FeaturedDraft,
  type MoveDirection,
} from './featuredFacts';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';
import { IconButton } from '../../../components/ui/IconButton';
import { describeApiError } from '../../../api/errors';

const EMPTY_DRAFT: FeaturedDraft = { username: '', listName: '', description: '' };

function AddFeaturedDialog({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [checked, setChecked] = useState(false);
  const add = useMutation({
    mutationFn: () =>
      addFeaturedList({
        username: draft.username.trim(),
        listName: draft.listName.trim(),
        description: draft.description.trim(),
      }),
    onSuccess: (added) => {
      client.setQueryData<AdminFeaturedResponse>(adminKeys.featured(), (current) =>
        current ? { featured: [...current.featured, added.featured] } : current,
      );
      void client.invalidateQueries({ queryKey: listsKeys.featured() });
      showToast('ok', `${added.featured.username}/${added.featured.list_name} is featured.`);
      onClose();
    },
  });
  const missing = checked ? draftErrors(draft) : {};
  const failure = add.isError ? addFeaturedFailure(add.error) : null;

  const set = (changes: Partial<FeaturedDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    if (add.isError) add.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(draftErrors(draft)).length === 0) add.mutate();
    else focusFirstInvalid(event.currentTarget);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Feature a list"
      description="Featured lists are shown on the public browse page. A new one goes last, and you can move it afterwards."
      dismissible={!add.isPending}
      closeOnBackdropClick={false}
      footer={
        <>
          <Button onClick={onClose} disabled={add.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="add-featured" loading={add.isPending}>
            Feature the list
          </Button>
        </>
      }
    >
      <form id="add-featured" onSubmit={submit} noValidate className="grid gap-3">
        <Field label="Username" error={missing.username ?? failure?.fields.username}>
          <Input
            value={draft.username}
            onChange={(event) => set({ username: event.target.value })}
            maxLength={MAX_FEATURED_NAME_LENGTH}
            placeholder="alex"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field
          label="List name"
          hint="The name of one of the account's published lists."
          error={missing.list_name ?? failure?.fields.list_name}
        >
          <Input
            mono
            value={draft.listName}
            onChange={(event) => set({ listName: event.target.value })}
            maxLength={MAX_FEATURED_NAME_LENGTH}
            placeholder="all_domains"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field
          label="Description (optional)"
          hint={`Shown under the list. At most ${formatInteger(MAX_FEATURED_DESCRIPTION_LENGTH)} characters.`}
          error={failure?.fields.description}
        >
          <Textarea
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            maxLength={MAX_FEATURED_DESCRIPTION_LENGTH}
            rows={3}
          />
        </Field>
        {failure?.form ? <Alert tone="fail">{failure.form}</Alert> : null}
      </form>
    </Dialog>
  );
}

function RemoveFeaturedDialog({ entry, onClose }: { entry: FeaturedList; onClose: () => void }) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title="Stop featuring this list?"
      confirmLabel="Remove from featured"
      destructive
      run={() => removeFeaturedList(entry.id)}
      onDone={() => {
        client.setQueryData<AdminFeaturedResponse>(adminKeys.featured(), (current) =>
          current ? { featured: current.featured.filter((item) => item.id !== entry.id) } : current,
        );
        void client.invalidateQueries({ queryKey: listsKeys.featured() });
        showToast('ok', `${entry.username}/${entry.list_name} is no longer featured.`);
      }}
      onClose={onClose}
      failureTitle="The list is still featured"
      fallback="Try again in a moment."
    >
      <p>
        <span className="font-mono text-[13px] break-all">
          {entry.username}/{entry.list_name}
        </span>{' '}
        is removed from the public browse page. The list itself is not changed.
      </p>
    </ActionDialog>
  );
}

export default function FeaturedPage() {
  useDocumentMeta(adminTitle('Featured lists'));
  const featured = useQuery(adminFeaturedListsQuery());
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<FeaturedList | null>(null);
  const client = useQueryClient();
  const move = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: MoveDirection }) => {
      const changes = planFeaturedMove(featured.data?.featured ?? [], index, direction);
      for (const change of changes) await moveFeaturedList(change.id, change.order);
    },
    onError: (error) => {
      showToast('fail', describeApiError(error, 'The list could not be moved. Try again.'));
    },
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.featured() }),
        client.invalidateQueries({ queryKey: listsKeys.featured() }),
      ]),
  });
  const count = featured.data?.featured.length ?? 0;

  return (
    <>
      <PageHeader
        title="Featured lists"
        description="Community lists shown on the public browse page."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>
            Feature a list
          </Button>
        }
      />
      <Card as="section" aria-label="Featured lists">
        {featured.data ? (
          featured.data.featured.length === 0 ? (
            <EmptyState
              title="No list is featured"
              headingLevel="h2"
              action={
                <Button size="sm" icon="plus" onClick={() => setAdding(true)}>
                  Feature a list
                </Button>
              }
            >
              Feature a published list from any account to show it on the browse page.
            </EmptyState>
          ) : (
            <Table>
              <caption className="sr-only">Featured lists in the order they are shown</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell align="right" hideOnNarrow>
                    Position
                  </TableHeaderCell>
                  <TableHeaderCell>Account</TableHeaderCell>
                  <TableHeaderCell>List</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Description</TableHeaderCell>
                  <TableHeaderCell align="right">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {featured.data.featured.map((entry, index) => (
                  <TableRow key={entry.id}>
                    <TableCell align="right" hideOnNarrow className="w-px">
                      {formatInteger(index + 1)}
                    </TableCell>
                    <TableCell className="break-all">{entry.username}</TableCell>
                    <TableCell className="font-mono text-[13px] break-all">
                      {entry.list_name}
                    </TableCell>
                    <TableCell hideOnNarrow className="text-text-secondary">
                      <span className="block max-w-[420px] break-words">
                        {entry.description || 'No description'}
                      </span>
                    </TableCell>
                    <TableCell align="right">
                      <span className="inline-flex items-center justify-end gap-1">
                        <IconButton
                          size="sm"
                          icon="arrow-up"
                          label={`Move ${entry.username}/${entry.list_name} up`}
                          disabled={index === 0 || move.isPending}
                          onClick={() => move.mutate({ index, direction: 'up' })}
                        />
                        <IconButton
                          size="sm"
                          icon="arrow-down"
                          label={`Move ${entry.username}/${entry.list_name} down`}
                          disabled={index === count - 1 || move.isPending}
                          onClick={() => move.mutate({ index, direction: 'down' })}
                        />
                        <Button
                          size="sm"
                          icon="trash"
                          onClick={() => setRemoving(entry)}
                          aria-label={`Remove ${entry.username}/${entry.list_name} from featured`}
                        >
                          Remove
                        </Button>
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )
        ) : featured.isError ? (
          <ErrorState
            title="Featured lists could not be loaded"
            headingLevel="h2"
            error={featured.error}
            onRetry={() => void featured.refetch()}
            retrying={featured.isFetching}
          />
        ) : (
          <LoadingRegion label="Loading featured lists…" className="grid gap-3 p-[18px]">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
          </LoadingRegion>
        )}
      </Card>
      {adding ? <AddFeaturedDialog onClose={() => setAdding(false)} /> : null}
      {removing ? (
        <RemoveFeaturedDialog entry={removing} onClose={() => setRemoving(null)} />
      ) : null}
    </>
  );
}
