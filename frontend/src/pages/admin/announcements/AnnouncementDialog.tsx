import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import {
  adminKeys,
  createAnnouncement,
  updateAnnouncement,
  type AnnouncementType,
} from '../../../api/admin';
import { accountKeys } from '../../../api/account';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../../components/ui/Field';
import { showToast } from '../../../components/ui/toasts';
import { ANNOUNCEMENT_TONES } from '../../../lib/notices';
import type { Announcement } from '../../../types';
import { focusFirstInvalid, formFailure } from '../shared/fieldErrors';
import {
  ANNOUNCEMENT_FIELDS,
  ANNOUNCEMENT_TYPES,
  MAX_MESSAGE_LENGTH,
  MAX_TITLE_LENGTH,
  announcementDraft,
  draftErrors,
  draftSubmission,
  type AnnouncementDraft,
} from './announcementFacts';

export interface AnnouncementDialogProps {
  announcement: Announcement | null;
  onClose: () => void;
}

export function AnnouncementDialog({ announcement, onClose }: AnnouncementDialogProps) {
  const client = useQueryClient();
  const [draft, setDraft] = useState<AnnouncementDraft>(() => announcementDraft(announcement));
  const [checked, setChecked] = useState(false);
  const save = useMutation({
    mutationFn: () => {
      const submission = draftSubmission(draft);
      return announcement
        ? updateAnnouncement(announcement.id, submission)
        : createAnnouncement(submission);
    },
    onSuccess: () => {
      showToast(
        'ok',
        announcement ? 'The announcement is updated.' : 'The announcement is published.',
      );
      onClose();
      return Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.announcements() }),
        client.invalidateQueries({ queryKey: accountKeys.announcements() }),
      ]);
    },
  });
  const clientErrors = checked ? draftErrors(draft) : {};
  const failure = save.isError
    ? formFailure(save.error, {
        fields: ANNOUNCEMENT_FIELDS,
        fallback: 'The announcement could not be saved.',
      })
    : null;

  const set = (changes: Partial<AnnouncementDraft>) => {
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
      title={announcement ? 'Edit the announcement' : 'New announcement'}
      description="Shown at the top of every signed-in dashboard until the person dismisses it."
      dismissible={!save.isPending}
      closeOnBackdropClick={false}
      footer={
        <>
          <Button onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="announcement" loading={save.isPending}>
            {announcement ? 'Save changes' : 'Publish'}
          </Button>
        </>
      }
    >
      <form id="announcement" onSubmit={submit} noValidate className="grid gap-3">
        <Field label="Title" error={clientErrors.title ?? failure?.fields.title}>
          <Input
            value={draft.title}
            onChange={(event) => set({ title: event.target.value })}
            maxLength={MAX_TITLE_LENGTH}
            autoComplete="off"
          />
        </Field>
        <Field label="Message" error={clientErrors.message ?? failure?.fields.message}>
          <Textarea
            value={draft.message}
            onChange={(event) => set({ message: event.target.value })}
            maxLength={MAX_MESSAGE_LENGTH}
            rows={4}
          />
        </Field>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 narrow:grid-cols-[minmax(0,1fr)]">
          <Field label="Type" error={failure?.fields.type}>
            <Select
              value={draft.type}
              onChange={(event) => set({ type: event.target.value as AnnouncementType })}
            >
              {ANNOUNCEMENT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Stops showing (optional)"
            hint="In your local time. Leave empty to show it until it is turned off."
            error={clientErrors.expires_at ?? failure?.fields.expires_at}
          >
            <Input
              type="datetime-local"
              value={draft.expiresLocal}
              onChange={(event) => set({ expiresLocal: event.target.value })}
            />
          </Field>
        </div>
        {draft.expiresLocal !== '' ? (
          <div>
            <Button size="sm" variant="ghost" onClick={() => set({ expiresLocal: '' })}>
              Clear the end time
            </Button>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <p className="text-[13px] font-medium">Preview</p>
          <Alert
            tone={ANNOUNCEMENT_TONES[draft.type]}
            title={draft.title.trim() || 'Title'}
            live={false}
          >
            {draft.message.trim() || 'Message'}
          </Alert>
        </div>
        {failure?.form ? <Alert tone="fail">{failure.form}</Alert> : null}
      </form>
    </Dialog>
  );
}
