import type { AdminSystemStats } from '../../../api/admin';
import { Card } from '../../../components/ui/Card';
import { Skeleton, StatCard } from '../../../components/ui/Layout';
import { StatusPill } from '../../../components/ui/StatusPill';
import { formatBytes, formatInteger } from '../../../lib/format';
import { workerState } from './overviewFacts';

const GRID = 'grid grid-cols-4 gap-4 compact:grid-cols-2';

export function SystemFigures({ stats }: { stats: AdminSystemStats }) {
  const workers = workerState(stats);
  const disabled = stats.users.total - stats.users.active;
  return (
    <section aria-label="System figures" className={GRID}>
      <StatCard
        label="Accounts"
        value={formatInteger(stats.users.total)}
        detail={`${formatInteger(stats.users.active)} enabled, ${formatInteger(disabled)} disabled`}
      />
      <StatCard
        label="Builds today"
        value={formatInteger(stats.jobs.today)}
        detail={`${formatInteger(stats.jobs.processing)} building, ${formatInteger(stats.jobs.queued)} queued`}
      />
      <StatCard
        label="Build workers"
        value={formatInteger(stats.workers.alive)}
        detail={workers.detail}
      >
        <StatusPill tone={workers.tone} icon={workers.icon}>
          {workers.label}
        </StatusPill>
      </StatCard>
      <StatCard
        label="Storage used"
        value={formatBytes(stats.storage.total_bytes)}
        detail={`Source cache: ${formatBytes(stats.storage.cache_bytes)}`}
      />
    </section>
  );
}

export function SystemFiguresSkeleton() {
  return (
    <div className={GRID}>
      {[0, 1, 2, 3].map((index) => (
        <Card key={index} className="grid gap-2.5 px-[18px] py-4">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-3 w-36" />
        </Card>
      ))}
    </div>
  );
}
