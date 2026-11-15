import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import type { Job, SourceProgress } from '../../types';
import { Icon } from './Icon';
import type { IconName } from './icons';
import {
  jobStatusDescription,
  sourceStatusDescription,
  type StatusDescription,
  type StatusTone,
} from './status';

const TONES: Record<StatusTone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  fail: 'bg-fail-soft text-fail',
  info: 'bg-info-soft text-info',
  neutral: 'bg-surface-raised text-text-secondary',
};

export interface StatusPillProps {
  tone?: StatusTone;
  icon?: IconName;
  spin?: boolean;
  className?: string;
  children: ReactNode;
}

export function StatusPill({
  tone = 'neutral',
  icon,
  spin = false,
  className,
  children,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] flex-none items-center gap-1.5 rounded-full pr-[9px] text-xs font-medium whitespace-nowrap',
        icon ? 'pl-[7px]' : 'pl-[9px]',
        TONES[tone],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={13} spin={spin} /> : null}
      {children}
    </span>
  );
}

export function DescribedPill({
  description,
  className,
}: {
  description: StatusDescription;
  className?: string;
}) {
  return (
    <StatusPill
      tone={description.tone}
      icon={description.icon}
      spin={description.spin}
      className={className}
    >
      {description.label}
    </StatusPill>
  );
}

export function JobStatusPill({
  status,
  className,
}: {
  status: Job['status'];
  className?: string;
}) {
  return <DescribedPill description={jobStatusDescription(status)} className={className} />;
}

export function SourceStatusPill({
  source,
  className,
}: {
  source: Pick<SourceProgress, 'status' | 'stale' | 'cache_hit'>;
  className?: string;
}) {
  return <DescribedPill description={sourceStatusDescription(source)} className={className} />;
}
