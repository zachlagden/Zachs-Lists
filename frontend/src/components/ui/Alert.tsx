import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';
import type { IconName } from './icons';
import { IconButton } from './IconButton';

export type AlertTone = 'info' | 'ok' | 'warn' | 'fail';

const TONES: Record<AlertTone, { classes: string; icon: IconName }> = {
  info: { classes: 'bg-info-soft text-info', icon: 'info' },
  ok: { classes: 'bg-ok-soft text-ok', icon: 'check' },
  warn: { classes: 'bg-warn-soft text-warn', icon: 'warn' },
  fail: { classes: 'bg-fail-soft text-fail', icon: 'fail' },
};

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  actions?: ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  live?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Alert({
  tone = 'info',
  title,
  actions,
  onDismiss,
  dismissLabel = 'Dismiss',
  live = true,
  className,
  children,
}: AlertProps) {
  const { classes, icon } = TONES[tone];
  const urgent = tone === 'fail' || tone === 'warn';
  return (
    <div
      role={live ? (urgent ? 'alert' : 'status') : undefined}
      className={cn(
        'flex items-start gap-2.5 rounded-control px-3.5 py-2.5 text-[13px]',
        classes,
        className,
      )}
    >
      <Icon name={icon} className="mt-0.5" />
      <div className="min-w-0 flex-1 break-words">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className={cn(title && 'mt-0.5')}>{children}</div> : null}
        {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {onDismiss ? (
        <IconButton
          label={dismissLabel}
          icon="close"
          size="sm"
          onClick={onDismiss}
          className="-my-1 -mr-1.5 text-current hover:text-current"
        />
      ) : null}
    </div>
  );
}
