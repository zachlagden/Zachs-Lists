import type { ReactNode } from 'react';
import { describeApiError } from '../../api/errors';
import { cn } from '../../lib/cn';
import { Button } from './Button';
import { Icon } from './Icon';
import type { IconName } from './icons';

type HeadingLevel = 'h1' | 'h2' | 'h3';

export interface EmptyStateProps {
  title: string;
  headingLevel?: HeadingLevel;
  icon?: IconName;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

export function EmptyState({
  title,
  headingLevel: Heading = 'h3',
  icon,
  action,
  compact = false,
  className,
  children,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'grid justify-items-start gap-1',
        compact ? 'py-1' : 'px-[18px] py-6',
        className,
      )}
    >
      {icon ? <Icon name={icon} size={18} className="mb-1 text-text-tertiary" /> : null}
      <Heading className="text-sm font-medium text-balance">{title}</Heading>
      {children ? (
        <div className="max-w-[62ch] text-[13px] break-words text-text-secondary">{children}</div>
      ) : null}
      {action ? <div className="mt-2 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title: string;
  headingLevel?: HeadingLevel;
  error?: unknown;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
  children?: ReactNode;
}

export function ErrorState({
  title,
  headingLevel: Heading = 'h3',
  error,
  onRetry,
  retrying = false,
  compact = false,
  className,
  children,
}: ErrorStateProps) {
  const detail =
    children ?? (error === undefined ? null : describeApiError(error, 'Try again in a moment.'));
  return (
    <div
      role="alert"
      className={cn(
        'grid justify-items-start gap-1',
        compact ? 'py-1' : 'px-[18px] py-6',
        className,
      )}
    >
      <Icon name="warn" size={18} className="mb-1 text-fail" />
      <Heading className="text-sm font-medium text-balance">{title}</Heading>
      {detail ? (
        <div className="max-w-[62ch] text-[13px] break-words text-text-secondary">{detail}</div>
      ) : null}
      {onRetry ? (
        <Button size="sm" icon="loop" loading={retrying} onClick={onRetry} className="mt-2">
          Try again
        </Button>
      ) : null}
    </div>
  );
}
