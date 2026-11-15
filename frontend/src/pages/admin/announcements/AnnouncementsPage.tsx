import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { accountKeys } from '../../../api/account';
import {
  adminAnnouncementsQuery,
  adminKeys,
  deleteAnnouncement,
  updateAnnouncement,
} from '../../../api/admin';
import { describeApiError } from '../../../api/errors';
import { Button } from '../../../components/ui/Button';
import { Card } from '../../../components/ui/Card';
import { LoadingRegion, PageHeader, Skeleton } from '../../../components/ui/Layout';
import { DescribedPill } from '../../../components/ui/StatusPill';
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
import { formatDateTime } from '../../../lib/format';
import { useNow } from '../../../lib/useNow';
import type { Announcement } from '../../../types';
import { ActionDialog } from '../shared/ActionDialog';
import { AnnouncementDialog } from './AnnouncementDialog';
import { announcementState, statePill, typePill } from './announcementFacts';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';

function DeleteAnnouncementDialog({
  announcement,
  onClose,
}: {
  announcement: Announcement;
  onClose: () => void;
}) {
  const client = useQueryClient();
  return (
    <ActionDialog
      title="Delete this announcement?"
      confirmLabel="Delete the announcement"
      destructive
      run={() => deleteAnnouncement(announcement.id)}
      onDone={() => {
        showToast('ok', 'The announcement is deleted.');
        void client.invalidateQueries({ queryKey: adminKeys.announcements() });
        void client.invalidateQueries({ queryKey: accountKeys.announcements() });
      }}
      onClose={onClose}
      failureTitle="The announcement was not deleted"
      fallback="Try again in a moment."
    >
      <p>
        <span className="font-medium text-text">{announcement.title}</span> is removed for everyone
        and cannot be restored. To hide it and keep it, turn it off instead.
      </p>
    </ActionDialog>
  );
}

type Editing = { announcement: Announcement | null };

export default function AnnouncementsPage() {
  useDocumentMeta(adminTitle('Announcements'));
  const client = useQueryClient();
  const now = useNow();
  const announcements = useQuery(adminAnnouncementsQuery());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const toggle = useMutation({
    mutationFn: (announcement: Announcement) =>
      updateAnnouncement(announcement.id, { is_active: !announcement.is_active }),
    onSuccess: (saved) => {
      showToast(
        'ok',
        saved.announcement.is_active
          ? 'The announcement is turned on.'
          : 'The announcement is turned off.',
      );
      return Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.announcements() }),
        client.invalidateQueries({ queryKey: accountKeys.announcements() }),
      ]);
    },
    onError: (error) => {
      showToast('fail', describeApiError(error, 'The announcement could not be changed.'));
    },
  });
  const rows = announcements.data?.announcements ?? [];

  return (
    <>
      <PageHeader
        title="Announcements"
        description="Messages shown at the top of every signed-in dashboard."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setEditing({ announcement: null })}>
            New announcement
          </Button>
        }
      />
      <Card as="section" aria-label="Announcements">
        {announcements.data ? (
          rows.length === 0 ? (
            <EmptyState
              title="No announcements"
              headingLevel="h2"
              action={
                <Button size="sm" icon="plus" onClick={() => setEditing({ announcement: null })}>
                  New announcement
                </Button>
              }
            >
              Publish one to tell every signed-in person about maintenance or a change.
            </EmptyState>
          ) : (
            <Table>
              <caption className="sr-only">Announcements, newest first</caption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Announcement</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Type</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Stops showing</TableHeaderCell>
                  <TableHeaderCell hideOnNarrow>Created</TableHeaderCell>
                  <TableHeaderCell align="right" hideOnNarrow>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((announcement) => {
                  const actions = (
                    <>
                      <Button
                        size="sm"
                        onClick={() => setEditing({ announcement })}
                        aria-label={`Edit the announcement ${announcement.title}`}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        loading={toggle.isPending && toggle.variables?.id === announcement.id}
                        onClick={() => toggle.mutate(announcement)}
                        aria-label={`${announcement.is_active ? 'Turn off' : 'Turn on'} the announcement ${announcement.title}`}
                      >
                        {announcement.is_active ? 'Turn off' : 'Turn on'}
                      </Button>
                      <Button
                        size="sm"
                        icon="trash"
                        onClick={() => setDeleting(announcement)}
                        aria-label={`Delete the announcement ${announcement.title}`}
                      >
                        Delete
                      </Button>
                    </>
                  );
                  return (
                    <TableRow key={announcement.id}>
                      <TableCell className="align-top">
                        <span className="font-medium break-words">{announcement.title}</span>
                        <span className="line-clamp-2 max-w-[52ch] text-[13px] break-words text-text-secondary">
                          {announcement.message}
                        </span>
                        <span className="mt-2 hidden flex-wrap gap-2 narrow:flex">{actions}</span>
                      </TableCell>
                      <TableCell hideOnNarrow className="align-top">
                        <DescribedPill description={typePill(announcement.type)} />
                      </TableCell>
                      <TableCell className="align-top">
                        <DescribedPill
                          description={statePill(announcementState(announcement, now))}
                        />
                      </TableCell>
                      <TableCell
                        hideOnNarrow
                        className="align-top whitespace-nowrap text-text-secondary"
                      >
                        {announcement.expires_at
                          ? formatDateTime(announcement.expires_at, { now })
                          : 'No end time'}
                      </TableCell>
                      <TableCell hideOnNarrow className="align-top text-text-secondary">
                        <span className="whitespace-nowrap">
                          {formatDateTime(announcement.created_at, { now })}
                        </span>
                        <span className="block text-xs break-all text-text-tertiary">
                          by {announcement.created_by}
                        </span>
                      </TableCell>
                      <TableCell align="right" hideOnNarrow className="align-top">
                        <span className="inline-flex justify-end gap-2">{actions}</span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )
        ) : announcements.isError ? (
          <ErrorState
            title="Announcements could not be loaded"
            headingLevel="h2"
            error={announcements.error}
            onRetry={() => void announcements.refetch()}
            retrying={announcements.isFetching}
          />
        ) : (
          <LoadingRegion label="Loading announcements…" className="grid gap-3 p-[18px]">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-full" />
          </LoadingRegion>
        )}
      </Card>
      {editing ? (
        <AnnouncementDialog
          key={editing.announcement?.id ?? 'new'}
          announcement={editing.announcement}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {deleting ? (
        <DeleteAnnouncementDialog announcement={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}
