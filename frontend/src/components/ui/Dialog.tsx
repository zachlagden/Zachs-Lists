import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { closesOnBackdropPress } from './dialogDismissal';
import { IconButton } from './IconButton';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md';
  dismissible?: boolean;
  closeOnBackdropClick?: boolean;
  children?: ReactNode;
}

const FIELD_SELECTOR = ':is(input:not([type="hidden"]), select, textarea):not(:disabled)';

function initialFocusTarget(dialog: HTMLDialogElement): HTMLElement | null {
  return (
    dialog.querySelector<HTMLElement>('[data-initial-focus]:not(:disabled)') ??
    dialog.querySelector<HTMLElement>(`[data-dialog-body] ${FIELD_SELECTOR}`) ??
    dialog.querySelector<HTMLElement>('[data-default-action]:not(:disabled)')
  );
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  size = 'md',
  dismissible = true,
  closeOnBackdropClick = true,
  children,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!dialog.open) {
      dialog.showModal();
      initialFocusTarget(dialog)?.focus();
    }
    return () => {
      if (dialog.open) dialog.close();
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (dismissible) onClose();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  };

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    const press = {
      dismissible,
      closeOnBackdropClick,
      pressStartedOnBackdrop: pressStartedOnBackdrop.current,
      pressEndedOnBackdrop: event.target === event.currentTarget,
    };
    pressStartedOnBackdrop.current = false;
    if (closesOnBackdropPress(press)) onClose();
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={handleCancel}
      onPointerDown={handlePointerDown}
      onClick={handleBackdropClick}
      className={cn(
        'm-auto max-h-[min(90vh,720px)] w-[calc(100vw-32px)] overflow-hidden rounded-card border border-border-strong bg-surface p-0 text-text shadow-overlay',
        size === 'sm' ? 'max-w-[420px]' : 'max-w-[520px]',
      )}
    >
      <div className="flex max-h-[min(90vh,720px)] flex-col">
        <div className="flex items-start gap-2.5 border-b border-border px-[18px] py-3.5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-sm font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-[13px] text-text-secondary">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              label="Close"
              icon="close"
              size="sm"
              onClick={onClose}
              className="-mr-1.5"
            />
          ) : null}
        </div>
        {children ? (
          <div data-dialog-body className="overflow-y-auto overscroll-contain p-[18px]">
            {children}
          </div>
        ) : null}
        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-[18px] py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  closeOnBackdropClick?: boolean;
  children?: ReactNode;
}

export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy = false,
  confirmDisabled = false,
  destructive = false,
  closeOnBackdropClick = true,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      dismissible={!busy}
      closeOnBackdropClick={closeOnBackdropClick}
      footer={
        <>
          <Button
            onClick={onCancel}
            disabled={busy}
            data-default-action={destructive ? '' : undefined}
          >
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            onClick={onConfirm}
            loading={busy}
            disabled={confirmDisabled}
            data-default-action={destructive ? undefined : ''}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ? <div className="text-text-secondary">{children}</div> : null}
    </Dialog>
  );
}
