import { focusFirstInvalid } from '../shared/fieldErrors';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  addLibraryEntry,
  adminKeys,
  updateLibraryEntry,
  type LibraryCategory,
  type LibraryEntry,
} from '../../../api/admin';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../components/ui/Field';
import { showToast } from '../../../components/ui/toasts';
import {
  CATEGORY_LABELS,
  MAX_DESCRIPTION_LENGTH,
  MAX_NAME_LENGTH,
  MAX_STRICTNESS,
  MAX_URL_LENGTH,
  MIN_STRICTNESS,
  draftErrors,
  draftSubmission,
  entryDraft,
  saveFailure,
  type LibraryDraft,
} from './libraryFacts';

export interface LibraryEntryDialogProps {
  entry: LibraryEntry | null;
  categories: LibraryCategory[];
  onClose: () => void;
}

export function LibraryEntryDialog({ entry, categories, onClose }: LibraryEntryDialogProps) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<LibraryDraft>(() => entryDraft(entry));
  const [checked, setChecked] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const submission = draftSubmission(draft);
      return entry ? updateLibraryEntry(entry.id, submission) : addLibraryEntry(submission);
    },
    onSuccess: (saved) => {
      showToast('ok', entry ? `${saved.entry.name} is updated.` : `${saved.entry.name} is added.`);
      onClose();
      return client.invalidateQueries({ queryKey: adminKeys.library() });
    },
  });
  const clientErrors = checked ? draftErrors(draft) : {};
  const failure = save.isError ? saveFailure(save.error) : null;
  const errorFor = (field: keyof typeof clientErrors) =>
    clientErrors[field] ?? failure?.fields[field];

  const set = (changes: Partial<LibraryDraft>) => {
    setDraft((current) => ({ ...current, ...changes }));
    if (save.isError) save.reset();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setChecked(true);
    if (Object.keys(draftErrors(draft)).length === 0) save.mutate();
    else focusFirstInvalid(event.currentTarget);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={entry ? `Edit ${entry.name}` : 'Add a library source'}
      description="Library sources are offered to every account when it chooses its sources."
      dismissible={!save.isPending}
      closeOnBackdropClick={false}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="library-entry" loading={save.isPending}>
            {entry ? 'Save changes' : 'Add the source'}
          </Button>
        </>
      }
    >
      <form id="library-entry" onSubmit={submit} noValidate className="grid gap-3">
        <Field label="Name" error={errorFor('name')}>
          <Input
            value={draft.name}
            onChange={(event) => set({ name: event.target.value })}
            maxLength={MAX_NAME_LENGTH}
            placeholder="Acme ad servers"
            autoComplete="off"
          />
        </Field>
        <Field label="Address" hint="An http or https address." error={errorFor('url')}>
          <Input
            mono
            type="url"
            inputMode="url"
            value={draft.url}
            onChange={(event) => set({ url: event.target.value })}
            maxLength={MAX_URL_LENGTH}
            placeholder="https://lists.example.org/ads.txt"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        </Field>
        <Field label="Category" error={errorFor('category')}>
          <Select
            value={draft.category}
            onChange={(event) => set({ category: event.target.value as LibraryCategory })}
          >
            {categories.map((category) => (
              <option key={category} value={category}>
                {CATEGORY_LABELS[category] ?? category}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Description (optional)"
          hint={`At most ${MAX_DESCRIPTION_LENGTH} characters.`}
          error={errorFor('description')}
        >
          <Textarea
            value={draft.description}
            onChange={(event) => set({ description: event.target.value })}
            maxLength={MAX_DESCRIPTION_LENGTH}
            rows={2}
          />
        </Field>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 narrow:grid-cols-[minmax(0,1fr)]">
          <Field
            label="Strictness"
            hint={`${MIN_STRICTNESS} blocks the least, ${MAX_STRICTNESS} the most.`}
            error={errorFor('aggressiveness')}
          >
            <Input
              inputMode="numeric"
              value={draft.aggressiveness}
              onChange={(event) => set({ aggressiveness: event.target.value })}
              autoComplete="off"
              className="num"
            />
          </Field>
          <Field
            label="Domains"
            hint="Roughly how many domains the list holds."
            error={errorFor('domain_count')}
          >
            <Input
              inputMode="numeric"
              value={draft.domainCount}
              onChange={(event) => set({ domainCount: event.target.value })}
              autoComplete="off"
              className="num"
            />
          </Field>
        </div>
        <label className="flex min-h-9 items-center gap-2 narrow:min-h-11">
          <input
            type="checkbox"
            checked={draft.recommended}
            onChange={(event) => set({ recommended: event.target.checked })}
            className="size-4 accent-[var(--accent-start)]"
          />
          Recommended
        </label>
        {failure?.fields.recommended ? (
          <p role="alert" className="text-xs text-fail">
            {failure.fields.recommended}
          </p>
        ) : null}
        {failure?.form ? <Alert tone="fail">{failure.form}</Alert> : null}
      </form>
    </Dialog>
  );
}
