import { useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Alert } from '../../../components/ui/Alert';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { formFailure } from './fieldErrors';

const NO_FIELDS: ReadonlyArray<never> = [];

export interface ActionDialogProps<Result, Field extends string = never> {
  title: string;
  confirmLabel: string;
  run: () => Promise<Result>;
  onDone: (result: Result) => void;
  onClose: () => void;
  failureTitle: string;
  fallback: string;
  fields?: ReadonlyArray<Field>;
  confirmDisabled?: boolean;
  destructive?: boolean;
  closeOnBackdropClick?: boolean;
  children: ReactNode | ((fieldErrors: Partial<Record<Field, string>>) => ReactNode);
}

export function ActionDialog<Result, Field extends string = never>({
  title,
  confirmLabel,
  run,
  onDone,
  onClose,
  failureTitle,
  fallback,
  fields = NO_FIELDS,
  confirmDisabled = false,
  destructive = false,
  closeOnBackdropClick = true,
  children,
}: ActionDialogProps<Result, Field>) {
  const action = useMutation({
    mutationFn: run,
    onSuccess: (result) => {
      onDone(result);
      onClose();
    },
  });
  const failure = action.isError ? formFailure(action.error, { fields, fallback }) : null;
  return (
    <ConfirmDialog
      open
      onCancel={onClose}
      onConfirm={() => action.mutate()}
      title={title}
      confirmLabel={confirmLabel}
      busy={action.isPending}
      confirmDisabled={confirmDisabled}
      destructive={destructive}
      closeOnBackdropClick={closeOnBackdropClick}
    >
      <div className="grid gap-3">
        {typeof children === 'function' ? children(failure?.fields ?? {}) : children}
        {failure?.form ? (
          <Alert tone="warn" title={failureTitle}>
            {failure.form}
          </Alert>
        ) : null}
      </div>
    </ConfirmDialog>
  );
}
