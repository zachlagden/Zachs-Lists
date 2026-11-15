import { useState, type ReactNode } from 'react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ConnectionBanner, ConnectionIndicator } from '../../components/ui/ConnectionBanner';
import { CopyButton } from '../../components/ui/CopyButton';
import { ConfirmDialog, Dialog } from '../../components/ui/Dialog';
import { Field, Input, Select, Textarea } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { IconButton } from '../../components/ui/IconButton';
import { ICON_NAMES } from '../../components/ui/icons';
import { KeyValueList, PageHeader, Skeleton, Stack, StatCard } from '../../components/ui/Layout';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { EmptyState, ErrorState } from '../../components/ui/States';
import { JobStatusPill, SourceStatusPill, StatusPill } from '../../components/ui/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '../../components/ui/Table';
import { Tabs } from '../../components/ui/Tabs';
import { showToast } from '../../components/ui/toasts';
import { UrlField } from '../../components/ui/UrlField';
import type { ConnectionState } from '../../realtime/backoff';
import { useConnectionStore } from '../../store';
import type { JobStatus } from '../../types';
import { useDocumentMeta } from '../../hooks/useDocumentMeta';

const JOB_STATUSES: JobStatus[] = ['queued', 'processing', 'completed', 'failed', 'skipped'];

const SOURCE_STATES = [
  { status: 'pending', stale: false, cache_hit: null },
  { status: 'downloading', stale: false, cache_hit: null },
  { status: 'processing', stale: false, cache_hit: false },
  { status: 'completed', stale: false, cache_hit: false },
  { status: 'completed', stale: false, cache_hit: true },
  { status: 'completed', stale: true, cache_hit: true },
  { status: 'failed', stale: false, cache_hit: false },
] as const;

const CONNECTION_STATES: ConnectionState[] = ['connected', 'connecting', 'reconnecting', 'offline'];

function Specimen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card as="section">
      <CardHeader title={title} />
      <CardBody className="grid gap-4">{children}</CardBody>
    </Card>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Specimens() {
  const [format, setFormat] = useState<'hosts' | 'plain' | 'adblock'>('hosts');
  const [tab, setTab] = useState<'sources' | 'whitelist'>('sources');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const connection = useConnectionStore((state) => state.state);
  const setConnection = useConnectionStore((state) => state.setState);
  return (
    <Stack>
      <Specimen title="Button and IconButton">
        <Row>
          <Button variant="primary" icon="bolt">
            Primary
          </Button>
          <Button icon="sliders">Default</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" loading>
            Loading
          </Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row>
          <Button size="sm">Small</Button>
          <Button size="sm" variant="ghost" icon="copy">
            Small ghost
          </Button>
          <Button size="lg" variant="primary">
            Large
          </Button>
          <Button to="/dev/components">Router link</Button>
          <Button href="https://example.com" target="_blank" rel="noopener noreferrer">
            External link
          </Button>
          <IconButton label="Open menu" icon="menu" />
          <IconButton label="Close" icon="close" size="sm" variant="default" />
        </Row>
      </Specimen>

      <Specimen title="Icon">
        <Row>
          {ICON_NAMES.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1.5 text-xs text-text-secondary"
            >
              <Icon name={name} />
              {name}
            </span>
          ))}
          <Icon name="loop" spin />
        </Row>
      </Specimen>

      <Specimen title="StatusPill, JobStatusPill and SourceStatusPill">
        <Row>
          <StatusPill tone="ok" icon="check">
            Published
          </StatusPill>
          <StatusPill tone="warn" icon="warn">
            Older copy
          </StatusPill>
          <StatusPill tone="fail" icon="fail">
            Failed
          </StatusPill>
          <StatusPill tone="info" icon="loop" spin>
            Building
          </StatusPill>
          <StatusPill icon="clock">Next rebuild in 6 hours</StatusPill>
          <StatusPill tone="warn">2</StatusPill>
        </Row>
        <Row>
          {JOB_STATUSES.map((status) => (
            <JobStatusPill key={status} status={status} />
          ))}
        </Row>
        <Row>
          {SOURCE_STATES.map((source, index) => (
            <SourceStatusPill key={index} source={source} />
          ))}
        </Row>
      </Specimen>

      <Specimen title="ProgressBar">
        <ProgressBar value={85} label="Domain limit used" />
        <ProgressBar value={53} tone="info" label="Download" />
        <ProgressBar value={100} tone="ok" label="Finished" />
        <ProgressBar value={0} tone="idle" thin label="Waiting" />
        <ProgressBar value={76} thin label="Sources used" />
      </Specimen>

      <Specimen title="SegmentedControl and Tabs">
        <SegmentedControl
          label="Format"
          value={format}
          onChange={setFormat}
          options={[
            { value: 'hosts', label: 'Hosts' },
            { value: 'plain', label: 'Plain' },
            { value: 'adblock', label: 'Adblock' },
          ]}
        />
        <Tabs
          label="Section"
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'sources', label: 'Sources', content: <p>Sources panel</p> },
            { value: 'whitelist', label: 'Whitelist', content: <p>Whitelist panel</p> },
          ]}
        />
      </Specimen>

      <Specimen title="Table">
        <Table flush>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Category list</TableHeaderCell>
              <TableHeaderCell hideOnNarrow>Hidden when narrow</TableHeaderCell>
              <TableHeaderCell align="right">Domains</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell>advertising</TableCell>
              <TableCell hideOnNarrow className="text-text-secondary">
                Ad servers
              </TableCell>
              <TableCell align="right">269,114</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>tracking</TableCell>
              <TableCell hideOnNarrow className="text-text-secondary">
                Telemetry
              </TableCell>
              <TableCell align="right">18,440</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Specimen>

      <Specimen title="Alert and toasts">
        <Alert tone="info" title="Scheduled maintenance" live={false}>
          Builds pause on Sunday between 02:00 and 03:00.
        </Alert>
        <Alert tone="ok" live={false} onDismiss={() => undefined}>
          Your limit request was approved.
        </Alert>
        <Alert tone="warn" live={false}>
          Live updates paused. Reconnecting.
        </Alert>
        <Alert
          tone="fail"
          title="Your lists are over the domain limit"
          live={false}
          actions={<Button size="sm">Review sources</Button>}
        >
          Remove some sources, or ask for a higher limit.
        </Alert>
        <Row>
          <Button size="sm" onClick={() => showToast('ok', 'Sources saved.')}>
            Show a status toast
          </Button>
          <Button size="sm" onClick={() => showToast('fail', 'The build was not started.')}>
            Show an alert toast
          </Button>
        </Row>
      </Specimen>

      <Specimen title="Dialog and ConfirmDialog">
        <Row>
          <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
          <Button onClick={() => setConfirmOpen(true)}>Open confirm dialog</Button>
        </Row>
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          title="Request a higher limit"
          description="An admin reviews each request."
          footer={<Button onClick={() => setDialogOpen(false)}>Close</Button>}
        >
          <Field label="Why you need it" hint="At least 10 characters">
            <Textarea placeholder="For example: a home network…" />
          </Field>
        </Dialog>
        <ConfirmDialog
          open={confirmOpen}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => setConfirmOpen(false)}
          title="Remove this source?"
          confirmLabel="Remove source"
        >
          The source is removed from your next build.
        </ConfirmDialog>
      </Specimen>

      <Specimen title="Field, Input, Textarea and Select">
        <Field label="Source name" hint="Shown in your build results">
          <Input placeholder="Acme Ads Basic…" autoComplete="off" />
        </Field>
        <Field label="Source address" error="Enter an address that starts with https://">
          <Input
            mono
            defaultValue="lists.example.org/ads.txt"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Category">
          <Select defaultValue="advertising">
            <option value="advertising">Advertising</option>
            <option value="tracking">Tracking</option>
          </Select>
        </Field>
        <Field label="Whitelist">
          <Textarea mono defaultValue={'example.com\n*.example.org'} spellCheck={false} />
        </Field>
        <Field label="Disabled">
          <Input disabled defaultValue="Read only while syncing" />
        </Field>
      </Specimen>

      <Specimen title="StatCard and KeyValueList">
        <div className="grid grid-cols-2 gap-4 narrow:grid-cols-1">
          <StatCard label="Unique domains" value="3,412,907" detail="85% of your 4,000,000 limit">
            <ProgressBar value={85} label="Domain limit used" />
          </StatCard>
          <StatCard label="Sources" value="38" detail="36 current · 1 older copy · 1 failed" />
        </div>
        <KeyValueList
          items={[
            { label: 'Started', value: '8 Nov, 06:40' },
            { label: 'Took', value: '1 min 48 s' },
            { label: 'Domains', value: '3,412,907' },
          ]}
        />
      </Specimen>

      <Specimen title="CopyButton and UrlField">
        <UrlField
          label="List address"
          url="https://lists.example.com/u/alex/all_domains.txt?format=hosts"
        />
        <Row>
          <CopyButton text="https://lists.example.com/u/alex/advertising.txt" />
          <CopyButton
            variant="ghost"
            text="https://lists.example.com/u/alex/tracking.txt"
            label="Copy address"
          />
        </Row>
      </Specimen>

      <Specimen title="EmptyState, ErrorState and Skeleton">
        <EmptyState
          title="No builds yet"
          icon="bolt"
          compact
          action={
            <Button size="sm" variant="primary">
              Build now
            </Button>
          }
        >
          Builds you start, and the weekly rebuild, are listed here.
        </EmptyState>
        <ErrorState title="Builds could not be loaded" compact onRetry={() => undefined}>
          Could not reach the server. Check your connection.
        </ErrorState>
        <div className="grid gap-2" aria-hidden="true">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      </Specimen>

      <Specimen title="ConnectionBanner and ConnectionIndicator">
        <div className="overflow-x-auto">
          <SegmentedControl
            label="Connection state"
            value={connection}
            onChange={setConnection}
            options={CONNECTION_STATES.map((state) => ({ value: state, label: state }))}
          />
        </div>
        <ConnectionIndicator />
        <ConnectionBanner className="mb-0" />
      </Specimen>
    </Stack>
  );
}

export default function ComponentsPage() {
  useDocumentMeta('Components');
  return (
    <div className="mx-auto max-w-[1160px] px-6 pb-16">
      <PageHeader
        title="Components"
        description="Every shared component in every state, in the dark theme and the light theme. Development builds only."
      />
      <div className="grid grid-cols-2 gap-4 compact:grid-cols-1">
        {(['dark', 'light'] as const).map((theme) => (
          <div
            key={theme}
            data-theme={theme}
            className="rounded-card border border-border bg-background p-4 text-text"
          >
            <h2 className="mb-3 text-sm font-semibold">{theme === 'dark' ? 'Dark' : 'Light'}</h2>
            <Specimens />
          </div>
        ))}
      </div>
    </div>
  );
}
