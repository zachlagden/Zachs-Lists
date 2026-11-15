import { useQuery } from '@tanstack/react-query';
import { ADMIN_JOBS_LIMIT, adminJobsQuery } from '../../../api/admin';
import { Card } from '../../../components/ui/Card';
import { Field, Input, Select } from '../../../components/ui/Field';
import { LoadingRegion, PageHeader } from '../../../components/ui/Layout';
import { jobStatusDescription } from '../../../components/ui/status';
import { EmptyState, ErrorState } from '../../../components/ui/States';
import { Button } from '../../../components/ui/Button';
import { formatInteger, pluralise } from '../../../lib/format';
import { useNow } from '../../../lib/useNow';
import { choiceFromSearch } from '../shared/urlState';
import { useUrlState, useUrlText } from '../shared/useUrlState';
import {
  BUILD_STATUSES,
  BUILD_TYPES,
  activeFirst,
  countActive,
  filterBuilds,
  type BuildFilters,
} from './buildFacts';
import { BuildsTable, BuildsTableSkeleton } from './BuildsTable';
import { BUILD_TYPE_LABELS } from '../../../lib/builds';
import { useDocumentMeta } from '../../../hooks/useDocumentMeta';
import { adminTitle } from '../shared/sections';

const STATUS_CHOICES = ['all', ...BUILD_STATUSES] as const;
const TYPE_CHOICES = ['all', ...BUILD_TYPES] as const;

export default function BuildsPage() {
  useDocumentMeta(adminTitle('Builds'));
  const now = useNow();
  const url = useUrlState();
  const { params, update } = url;
  const [query, setQuery] = useUrlText(url, 'q');
  const jobs = useQuery(adminJobsQuery());

  const filters: BuildFilters = {
    status: choiceFromSearch(params, 'status', STATUS_CHOICES, 'all'),
    type: choiceFromSearch(params, 'type', TYPE_CHOICES, 'all'),
    search: query,
  };
  const filtered = filters.status !== 'all' || filters.type !== 'all' || filters.search !== '';
  const all = jobs.data?.jobs ?? [];
  const shown = activeFirst(filterBuilds(all, filters));
  const active = countActive(all);

  return (
    <>
      <PageHeader
        title="Builds"
        description={`The ${formatInteger(ADMIN_JOBS_LIMIT)} most recent builds across every account and the default lists. Running and queued builds stay at the top and update as they progress.`}
      />
      <Card as="section" aria-label="All builds">
        <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-b border-border p-[18px] narrow:grid-cols-[minmax(0,1fr)] narrow:p-3">
          <Field label="Search by account">
            <Input
              type="search"
              value={filters.search}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="alex"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <Field label="Result">
            <Select
              value={filters.status}
              onChange={(event) =>
                update({ status: event.target.value === 'all' ? null : event.target.value })
              }
            >
              <option value="all">Any result</option>
              {BUILD_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {jobStatusDescription(status).label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Type">
            <Select
              value={filters.type}
              onChange={(event) =>
                update({ type: event.target.value === 'all' ? null : event.target.value })
              }
            >
              <option value="all">Any type</option>
              {BUILD_TYPES.map((type) => (
                <option key={type} value={type}>
                  {BUILD_TYPE_LABELS[type]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {jobs.data ? (
          <>
            <p
              role="status"
              className="num border-b border-border px-[18px] py-2.5 text-[13px] text-text-secondary narrow:px-3"
            >
              {filtered
                ? `${pluralise(shown.length, 'build')} of ${formatInteger(all.length)} match. `
                : `${pluralise(all.length, 'build')}. `}
              {active === 0
                ? 'None is running or queued.'
                : `${formatInteger(active)} running or queued.`}
            </p>
            {shown.length === 0 ? (
              <EmptyState
                title={filtered ? 'No build matches these filters' : 'No builds yet'}
                action={
                  filtered ? (
                    <Button
                      size="sm"
                      onClick={() => {
                        setQuery('');
                        update({ status: null, type: null });
                      }}
                    >
                      Clear the filters
                    </Button>
                  ) : undefined
                }
              >
                {filtered
                  ? 'Older builds drop off this list, so a build may no longer be among the most recent.'
                  : 'Builds appear here as soon as an account or the weekly schedule starts one.'}
              </EmptyState>
            ) : (
              <BuildsTable jobs={shown} now={now} caption="Builds across every account" />
            )}
          </>
        ) : jobs.isError ? (
          <ErrorState
            title="Builds could not be loaded"
            headingLevel="h2"
            error={jobs.error}
            onRetry={() => void jobs.refetch()}
            retrying={jobs.isFetching}
          />
        ) : (
          <LoadingRegion label="Loading builds…">
            <BuildsTableSkeleton />
          </LoadingRegion>
        )}
      </Card>
    </>
  );
}
