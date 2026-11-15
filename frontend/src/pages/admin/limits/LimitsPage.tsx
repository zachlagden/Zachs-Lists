import { useQuery } from '@tanstack/react-query';
import { adminStatsQuery } from '../../../api/admin';
import { PageHeader, Stack } from '../../../components/ui/Layout';
import { useNow } from '../../../lib/useNow';
import type { Enforcement } from './limitFacts';
import { RequestsCard } from './RequestsCard';
import { ReviewsCard } from './ReviewsCard';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';

export default function LimitsPage() {
  useDocumentMeta(adminTitle('Limits'));
  const now = useNow();
  const stats = useQuery(adminStatsQuery());
  const enforcement: Enforcement = stats.data
    ? stats.data.limits.enforce_domain_limit
      ? 'on'
      : 'off'
    : stats.isError
      ? 'unknown'
      : 'loading';
  return (
    <>
      <PageHeader
        title="Limits"
        description="Accounts measured over their domain limit, and requests for a higher one."
      />
      <Stack>
        <ReviewsCard enforcement={enforcement} now={now} />
        <RequestsCard now={now} />
      </Stack>
    </>
  );
}
