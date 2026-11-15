import { cn } from '../../../lib/cn';

export interface BarChartBar {
  key: string;
  label: string;
  value: number;
  marked: number;
}

export interface BarChartProps {
  summary: string;
  bars: BarChartBar[];
  className?: string;
}

function percentOf(value: number, peak: number): number {
  return peak > 0 ? (value / peak) * 100 : 0;
}

export function BarChart({ summary, bars, className }: BarChartProps) {
  const peak = Math.max(0, ...bars.map((bar) => bar.value));
  return (
    <div
      role="img"
      aria-label={summary}
      className={cn('flex h-28 items-end gap-[3px] border-b border-border', className)}
    >
      {bars.map((bar) => (
        <div
          key={bar.key}
          title={bar.label}
          className="flex h-full min-w-0 flex-1 flex-col justify-end"
        >
          <div
            className="flex min-h-px flex-col justify-end overflow-hidden rounded-t-[3px] bg-info"
            style={{ height: `${percentOf(bar.value, peak)}%` }}
          >
            {bar.marked > 0 ? (
              <div className="bg-fail" style={{ height: `${percentOf(bar.marked, bar.value)}%` }} />
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
