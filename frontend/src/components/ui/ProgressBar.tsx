import { cn } from '../../lib/cn';

export type ProgressTone = 'accent' | 'info' | 'ok' | 'idle';

const FILLS: Record<ProgressTone, string> = {
  accent: 'bg-accent',
  info: 'bg-info',
  ok: 'bg-ok',
  idle: 'bg-border-strong',
};

export interface ProgressBarProps {
  value: number;
  max?: number;
  label: string;
  valueText?: string;
  tone?: ProgressTone;
  thin?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  label,
  valueText,
  tone = 'accent',
  thin = false,
  className,
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const percent = (clamped / safeMax) * 100;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={valueText}
      className={cn(
        'overflow-hidden rounded-full bg-surface-raised',
        thin ? 'h-1' : 'h-1.5',
        className,
      )}
    >
      <div
        className={cn(
          'h-full rounded-full transition-[width] duration-[400ms] ease-out',
          FILLS[tone],
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
