import { cn } from '../../lib/cn';
import type { ConnectionState } from '../../realtime/backoff';
import { useConnectionStore } from '../../store';
import { Icon } from './Icon';

const MESSAGES: Record<Exclude<ConnectionState, 'connected' | 'connecting'>, string> = {
  reconnecting: 'Live updates paused. Reconnecting…',
  offline: 'You are offline. Figures on this page may be out of date until the connection returns.',
};

export function ConnectionBanner({ className }: { className?: string }) {
  const state = useConnectionStore((connection) => connection.state);
  if (state === 'connected' || state === 'connecting') return null;
  return (
    <div
      role="status"
      className={cn(
        'mb-4 flex items-center gap-2.5 rounded-control bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn',
        className,
      )}
    >
      <Icon name={state === 'offline' ? 'offline' : 'loop'} spin={state === 'reconnecting'} />
      {MESSAGES[state]}
    </div>
  );
}

const INDICATOR: Record<ConnectionState, { label: string; dot: string }> = {
  connected: { label: 'Live', dot: 'bg-ok shadow-[0_0_0_3px_var(--ok-soft)]' },
  connecting: { label: 'Connecting…', dot: 'bg-text-tertiary' },
  reconnecting: { label: 'Reconnecting…', dot: 'bg-warn shadow-[0_0_0_3px_var(--warn-soft)]' },
  offline: { label: 'Offline', dot: 'bg-fail shadow-[0_0_0_3px_var(--fail-soft)]' },
};

export function ConnectionIndicator({ className }: { className?: string }) {
  const state = useConnectionStore((connection) => connection.state);
  const { label, dot } = INDICATOR[state];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-text-secondary', className)}>
      <span aria-hidden="true" className={cn('size-[7px] rounded-full', dot)} />
      {label}
    </span>
  );
}
