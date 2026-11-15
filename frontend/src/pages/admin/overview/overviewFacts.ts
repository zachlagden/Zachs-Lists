import type { AdminSystemStats, JobsPerDayPoint } from '../../../api/admin';
import type { StatusTone } from '../../../components/ui/status';
import type { IconName } from '../../../components/ui/icons';
import { formatDate, formatInteger, pluralise } from '../../../lib/format';
import type { AdminAnalytics, AnalyticsDay, AnalyticsReport, Job } from '../../../types';

export const FAILED_BUILDS_SHOWN = 5;

export type AnalyticsScope = 'overall' | 'default_lists' | 'user_lists';

export const ANALYTICS_SCOPES: ReadonlyArray<{ value: AnalyticsScope; label: string }> = [
  { value: 'overall', label: 'All lists' },
  { value: 'default_lists', label: 'Default lists' },
  { value: 'user_lists', label: 'User lists' },
];

export function scopedReport(analytics: AdminAnalytics, scope: AnalyticsScope): AnalyticsReport {
  return analytics[scope];
}

export interface Bar {
  key: string;
  label: string;
  value: number;
  marked: number;
}

function dayLabel(date: string): string {
  return formatDate(`${date}T00:00:00Z`, { timeZone: 'UTC' });
}

export function downloadBars(daily: AnalyticsDay[]): Bar[] {
  return daily.map((day) => ({
    key: day.date,
    label: `${dayLabel(day.date)}: ${pluralise(day.requests, 'download')}`,
    value: day.requests,
    marked: 0,
  }));
}

const DAY_MS = 86_400_000;

export function fillDays(days: JobsPerDayPoint[], now: Date, span: number): JobsPerDayPoint[] {
  const byDate = new Map(days.map((day) => [day.date, day]));
  return Array.from({ length: span }, (_, index) => {
    const date = new Date(now.getTime() - (span - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    return byDate.get(date) ?? { date, total: 0, completed: 0, failed: 0 };
  });
}

export function buildBars(days: JobsPerDayPoint[]): Bar[] {
  return days.map((day) => ({
    key: day.date,
    label: `${dayLabel(day.date)}: ${pluralise(day.total, 'build')}, ${formatInteger(day.failed)} failed`,
    value: day.total,
    marked: day.failed,
  }));
}

export function barSummary(bars: Bar[], noun: string): string {
  if (bars.length === 0) return `No ${noun}s recorded.`;
  const total = bars.reduce((sum, bar) => sum + bar.value, 0);
  const marked = bars.reduce((sum, bar) => sum + bar.marked, 0);
  const peak = bars.reduce((highest, bar) => (bar.value > highest.value ? bar : highest));
  const failed = marked > 0 ? `, ${formatInteger(marked)} failed` : '';
  return `${pluralise(total, noun)} over ${pluralise(bars.length, 'day')}${failed}. Busiest day: ${peak.label}.`;
}

export interface WorkerState {
  tone: StatusTone;
  icon: IconName;
  label: string;
  detail: string;
}

export function workerState(stats: AdminSystemStats): WorkerState {
  const waiting = stats.jobs.queued + stats.jobs.processing;
  if (stats.workers.alive === 0) {
    return {
      tone: 'fail',
      icon: 'fail',
      label: 'No worker running',
      detail:
        waiting > 0
          ? `${pluralise(waiting, 'build')} will wait until a worker starts`
          : 'Builds will wait until a worker starts',
    };
  }
  return {
    tone: 'ok',
    icon: 'check',
    label: 'Running',
    detail: `${formatInteger(stats.jobs.processing)} building, ${formatInteger(stats.jobs.queued)} queued`,
  };
}

export function recentFailedBuilds(jobs: Job[]): Job[] {
  return jobs.filter((job) => job.status === 'failed').slice(0, FAILED_BUILDS_SHOWN);
}
