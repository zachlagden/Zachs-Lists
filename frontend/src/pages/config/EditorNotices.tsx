import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import type { EditorNotice } from './useConfigActions';

export function NoticeAlert({
  notice,
  onDismiss,
}: {
  notice: EditorNotice;
  onDismiss: () => void;
}) {
  return (
    <Alert
      tone={notice.tone}
      title={notice.title}
      onDismiss={onDismiss}
      actions={
        notice.buildJobId ? (
          <Button to={`/jobs/${encodeURIComponent(notice.buildJobId)}`} size="sm">
            View the running build
          </Button>
        ) : undefined
      }
    >
      {notice.message}
    </Alert>
  );
}

export function RestoreAlert({
  onRestore,
  onDiscard,
}: {
  onRestore: () => void;
  onDiscard: () => void;
}) {
  return (
    <Alert
      tone="info"
      title="You have unsaved changes from before"
      actions={
        <>
          <Button size="sm" variant="ghost" onClick={onDiscard}>
            Discard them
          </Button>
          <Button size="sm" onClick={onRestore}>
            Restore them
          </Button>
        </>
      }
    >
      Changes you had not saved were kept in this browser tab when the page closed or your session
      ended. They are not on the server.
    </Alert>
  );
}

export function ConflictDialog({
  open,
  onTakeServerVersion,
  onKeepMyEdits,
}: {
  open: boolean;
  onTakeServerVersion: () => void;
  onKeepMyEdits: () => void;
}) {
  return (
    <Dialog
      open={open}
      onClose={onKeepMyEdits}
      title="Your configuration changed somewhere else"
      size="sm"
      footer={
        <>
          <Button onClick={onTakeServerVersion}>Load the saved version</Button>
          <Button variant="primary" onClick={onKeepMyEdits} data-initial-focus>
            Keep editing mine
          </Button>
        </>
      }
    >
      <div className="grid gap-2 text-text-secondary">
        <p>
          The saved sources or whitelist were changed in another tab or device after you opened this
          page, so your unsaved edits were not saved over them.
        </p>
        <p>
          Load the saved version to drop your edits here. Keep editing to hold on to them. Saving
          then replaces the other change.
        </p>
      </div>
    </Dialog>
  );
}

export function TemplateDialog({
  open,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      busy={busy}
      destructive
      title="Replace your configuration?"
      confirmLabel="Replace with the default template"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <div className="grid gap-2">
        <p>This replaces your saved sources and your saved whitelist with the default template.</p>
        <p>
          Everything in both is deleted, along with any unsaved edits on this page. This cannot be
          undone. Your published lists stay as they are until the next build.
        </p>
      </div>
    </ConfirmDialog>
  );
}
