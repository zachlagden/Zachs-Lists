import type { AdminUserDetail } from '../../../../api/admin';
import { Card, CardBody, CardHeader } from '../../../../components/ui/Card';
import { KeyValueList } from '../../../../components/ui/Layout';
import { DescribedPill } from '../../../../components/ui/StatusPill';
import {
  formatBytes,
  formatDateTime,
  formatInteger,
  formatRelativeTime,
} from '../../../../lib/format';
import { lastSeen, roleDescription, stateDescription } from '../userFacts';

export function ProfileCard({ user, now }: { user: AdminUserDetail; now: Date }) {
  const role = roleDescription(user);
  const state = stateDescription(user);
  const seen = lastSeen(user);
  return (
    <Card as="section" aria-labelledby="user-profile">
      <CardHeader
        title="Profile"
        titleId="user-profile"
        actions={
          <>
            <DescribedPill description={role} />
            <DescribedPill description={state} />
          </>
        }
      />
      <CardBody>
        <KeyValueList
          className="[&_dd]:break-all"
          items={[
            { label: 'GitHub username', value: user.github_username },
            { label: 'GitHub account number', value: String(user.github_id) },
            { label: 'Name', value: user.name ?? 'Not given' },
            { label: 'Email', value: user.email ?? 'Not given' },
            { label: 'Joined', value: formatDateTime(user.created_at, { now }) || 'Unknown' },
            { label: 'Last seen', value: seen ? formatRelativeTime(seen, now) : 'Never' },
            {
              label: 'Last build',
              value: user.stats.last_build_at
                ? formatDateTime(user.stats.last_build_at, { now })
                : 'Never',
            },
            { label: 'Published lists', value: formatInteger(user.lists.length) },
            { label: 'Domains', value: formatInteger(user.stats.total_domains) },
            { label: 'Size of the lists', value: formatBytes(user.stats.total_output_size_bytes) },
            {
              label: 'Manual builds this week',
              value: user.is_root
                ? formatInteger(user.stats.manual_updates_this_week)
                : `${formatInteger(user.stats.manual_updates_this_week)} of ${formatInteger(user.limits.manual_updates_per_week)}`,
            },
          ]}
        />
      </CardBody>
    </Card>
  );
}
