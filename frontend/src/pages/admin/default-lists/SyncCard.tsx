import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminKeys, runDefaultSync } from '../../../api/admin';
import { describeApiError } from '../../../api/errors';
import { Alert } from '../../../components/ui/Alert';
import { Button } from '../../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../../components/ui/Card';
import { ConfirmDialog } from '../../../components/ui/Dialog';
import { KeyValueList } from '../../../components/ui/Layout';
import { StatusPill } from '../../../components/ui/StatusPill';
import { formatDateTime, formatInteger } from '../../../lib/format';
import type { DefaultConfig, DefaultSyncStatus } from '../../../types';
import { RebuildDefaultLists } from '../shared/RebuildDefaultLists';
import {
  commitUrl,
  countEntries,
  repositoryUrl,
  shortSha,
  syncOutcomeMessage,
} from './defaultListFacts';

const LINK = 'break-all underline hover:text-accent-text';

function ExternalLink({ href, children }: { href: string | null; children: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK}>
      {children}
    </a>
  );
}

export interface SyncCardProps {
  config: DefaultConfig;
  status: DefaultSyncStatus;
  now: Date;
}

export function SyncCard({ config, status, now }: SyncCardProps) {
  const client = useQueryClient();
  const [confirmingForce, setConfirmingForce] = useState(false);
  const sync = useMutation({
    mutationFn: (force: boolean) => runDefaultSync(force),
    onSettled: () => {
      setConfirmingForce(false);
      return Promise.all([
        client.invalidateQueries({ queryKey: adminKeys.defaultConfig() }),
        client.invalidateQueries({ queryKey: adminKeys.defaultSync() }),
        client.invalidateQueries({ queryKey: adminKeys.jobs() }),
      ]);
    },
  });
  const source = status.source;
  const repo = source?.repo ?? status.repo;
  const outcome = sync.data ? syncOutcomeMessage(sync.data) : null;
  const time = (value: string | null | undefined) =>
    value ? formatDateTime(value, { now }) : 'Never';

  return (
    <Card as="section" aria-labelledby="default-sync">
      <CardHeader
        title="Where the default lists come from"
        titleId="default-sync"
        actions={
          status.sync_enabled ? (
            <StatusPill tone="ok" icon="loop">
              Synced from GitHub
            </StatusPill>
          ) : (
            <StatusPill icon="dash">Sync is off</StatusPill>
          )
        }
        className="flex-wrap"
      />
      <CardBody className="grid gap-4">
        <p className="max-w-[72ch] text-[13px] text-text-secondary">
          {status.sync_enabled
            ? 'The sources and whitelist are copied from the repository each hour, at the commit of its latest published build. Change them in the repository, not here.'
            : 'The default lists are built from the sources and whitelist stored on this site, which you can edit below.'}
        </p>
        <KeyValueList
          className="max-w-[560px]"
          items={[
            ...(status.sync_enabled || source
              ? [
                  {
                    label: 'Repository',
                    value: (
                      <ExternalLink href={repositoryUrl(repo)}>{repo || 'Not set'}</ExternalLink>
                    ),
                  },
                  {
                    label: 'Commit',
                    value: source?.commit_sha ? (
                      <ExternalLink href={commitUrl(repo, source.commit_sha)}>
                        {shortSha(source.commit_sha)}
                      </ExternalLink>
                    ) : (
                      'Not synced yet'
                    ),
                  },
                  { label: 'Commit date', value: time(source?.commit_date) },
                  { label: 'Synced', value: time(source?.synced_at) },
                  { label: 'Last checked', value: time(source?.last_checked_at) },
                ]
              : []),
            { label: 'Sources', value: formatInteger(countEntries(config.config)) },
            { label: 'Whitelist entries', value: formatInteger(countEntries(config.whitelist)) },
          ]}
        />
        {source?.last_error && !outcome ? (
          <Alert tone="warn" live={false} title="The last sync reported a problem">
            {source.last_error}
          </Alert>
        ) : null}
        {outcome ? (
          <Alert
            tone={outcome.tone}
            title={outcome.title}
            onDismiss={() => sync.reset()}
            actions={
              outcome.jobId ? (
                <Button size="sm" to={`/admin/jobs/${encodeURIComponent(outcome.jobId)}`}>
                  View the build
                </Button>
              ) : outcome.canForce ? (
                <Button size="sm" onClick={() => setConfirmingForce(true)}>
                  Force sync
                </Button>
              ) : undefined
            }
          >
            {outcome.detail}
          </Alert>
        ) : null}
        {sync.isError ? (
          <Alert tone="fail" title="The sync could not be run" onDismiss={() => sync.reset()}>
            {describeApiError(sync.error, 'Try again in a moment.')}
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <RebuildDefaultLists />
          {status.sync_enabled ? (
            <>
              <Button disabled={sync.isPending} onClick={() => setConfirmingForce(true)}>
                Force sync
              </Button>
              <Button
                variant="primary"
                icon="loop"
                loading={sync.isPending && !confirmingForce}
                disabled={sync.isPending}
                onClick={() => sync.mutate(false)}
              >
                Sync now
              </Button>
            </>
          ) : null}
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirmingForce}
        onCancel={() => setConfirmingForce(false)}
        onConfirm={() => sync.mutate(true)}
        title="Force a sync?"
        confirmLabel="Force sync"
        busy={sync.isPending}
      >
        <p>
          A normal sync stops when the repository lists fewer than half as many sources as the
          stored configuration, because that usually means a broken file. Forcing skips that check
          and stores whatever the repository has.
        </p>
      </ConfirmDialog>
    </Card>
  );
}
