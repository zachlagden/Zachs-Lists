import type { ReactNode } from 'react';
import type { Blocker } from 'react-router-dom';
import { ConfirmDialog } from './Dialog';

export interface LeaveDialogProps {
  blocker: Blocker;
  onLeave?: () => void;
  children: ReactNode;
}

export function LeaveDialog({ blocker, onLeave, children }: LeaveDialogProps) {
  return (
    <ConfirmDialog
      open={blocker.state === 'blocked'}
      destructive
      title="Leave without saving?"
      confirmLabel="Leave and discard"
      cancelLabel="Stay"
      onCancel={() => blocker.reset?.()}
      onConfirm={() => {
        onLeave?.();
        blocker.proceed?.();
      }}
    >
      {children}
    </ConfirmDialog>
  );
}
