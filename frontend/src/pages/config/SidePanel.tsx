import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { StatusPill } from '../../components/ui/StatusPill';
import { formatInteger, formatPercent, formatRelativeTime, pluralise } from '../../lib/format';
import type { DomainUsage } from '../dashboard/dashboardFacts';
import type { LocatedIssue } from './configFacts';
import type { EditorTab } from './editorState';

export interface LimitsCardProps {
  sourceCount: number;
  sourceLimit: number;
  usage: DomainUsage | null;
  hasBuilt: boolean;
  isAdmin: boolean;
  canRequestMore: boolean;
  hasPendingRequest: boolean;
  onRequestMore: () => void;
}

function Meter({
  label,
  detail,
  value,
  max,
  over,
}: {
  label: string;
  detail: string;
  value: number;
  max: number;
  over: boolean;
}) {
  return (
    <div>
      <div className="mb-1.5 flex flex-wrap justify-between gap-x-3">
        <span>{label}</span>
        <span className={over ? 'num text-fail' : 'num text-text-secondary'}>{detail}</span>
      </div>
      <ProgressBar thin label={label} value={value} max={max} valueText={detail} />
    </div>
  );
}

export function LimitsCard({
  sourceCount,
  sourceLimit,
  usage,
  hasBuilt,
  isAdmin,
  canRequestMore,
  hasPendingRequest,
  onRequestMore,
}: LimitsCardProps) {
  return (
    <Card as="section" aria-labelledby="config-limits">
      <CardHeader title="Limits" titleId="config-limits" />
      <CardBody className="grid gap-3.5">
        <Meter
          label="Sources"
          detail={`${formatInteger(sourceCount)} of ${formatInteger(sourceLimit)}`}
          value={sourceCount}
          max={sourceLimit}
          over={sourceCount > sourceLimit}
        />
        {usage && hasBuilt ? (
          isAdmin ? (
            <div className="flex flex-wrap justify-between gap-x-3">
              <span>Domains, last build</span>
              <span className="num text-text-secondary">
                {formatInteger(usage.domains)}, no limit for admins
              </span>
            </div>
          ) : (
            <Meter
              label="Domains, last build"
              detail={`${usage.exact ? '' : 'about '}${formatInteger(usage.domains)} of ${formatInteger(usage.limit)}`}
              value={usage.domains}
              max={usage.limit}
              over={usage.over}
            />
          )
        ) : (
          <p className="text-[13px] text-text-secondary">
            Domains are counted across all categories when a build finishes.
            {usage && !isAdmin ? ` Your limit is ${formatInteger(usage.limit)}.` : ''}
          </p>
        )}
        {usage && hasBuilt && !isAdmin ? (
          <p className="text-xs text-text-tertiary">
            {formatPercent(usage.ratio)} of your domain limit, counted across all categories.
          </p>
        ) : null}
        {isAdmin ? null : hasPendingRequest ? (
          <p className="text-[13px] text-text-secondary">
            Your request for a higher domain limit is waiting for a decision.
          </p>
        ) : canRequestMore ? (
          <div>
            <Button size="sm" onClick={onRequestMore}>
              Request a higher limit
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export type SourceCheckStatus = 'unchecked' | 'outdated' | 'checking' | 'checked';

export interface CheckProgress {
  current: number;
  total: number;
}

export interface CheckCardProps {
  tab: EditorTab;
  status: SourceCheckStatus;
  progress: CheckProgress | null;
  issues: LocatedIssue[];
  checkedCount: number;
  checkedAt: number | null;
  sourceCount: number;
  whitelistIssues: LocatedIssue[];
  now: Date;
  onCheck: () => void;
  onJump: (tab: EditorTab, lineNumber: number) => void;
}

function IssueList({
  issues,
  onJump,
}: {
  issues: LocatedIssue[];
  onJump: (lineNumber: number) => void;
}) {
  return (
    <ul className="m-0 list-none p-0">
      {issues.map((issue, index) => (
        <li
          key={`${issue.lineNumber}-${index}`}
          className="flex gap-3 border-b border-border py-3 first:pt-0 last:border-b-0 last:pb-0"
        >
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-medium">
              {issue.lineNumber === null ? (
                'Whole file'
              ) : (
                <button
                  type="button"
                  onClick={() => onJump(issue.lineNumber ?? 1)}
                  className="rounded-sm border-0 bg-transparent p-0 font-medium underline hover:text-accent-text narrow:min-h-11"
                >
                  Line {issue.lineNumber}
                </button>
              )}
            </h3>
            <p className="mt-0.5 text-[13px] break-words text-text-secondary">{issue.message}</p>
          </div>
          {issue.severity === 'error' ? (
            <StatusPill tone="fail" icon="fail">
              Error
            </StatusPill>
          ) : (
            <StatusPill tone="warn" icon="warn">
              Warning
            </StatusPill>
          )}
        </li>
      ))}
    </ul>
  );
}

function summaryPill(issues: LocatedIssue[]) {
  const errors = issues.filter((issue) => issue.severity === 'error').length;
  if (errors > 0) {
    return (
      <StatusPill tone="fail" icon="fail">
        {pluralise(errors, 'error')}
      </StatusPill>
    );
  }
  if (issues.length > 0) {
    return (
      <StatusPill tone="warn" icon="warn">
        {pluralise(issues.length, 'warning')}
      </StatusPill>
    );
  }
  return (
    <StatusPill tone="ok" icon="check">
      No problems
    </StatusPill>
  );
}

export function CheckCard({
  tab,
  status,
  progress,
  issues,
  checkedCount,
  checkedAt,
  sourceCount,
  whitelistIssues,
  now,
  onCheck,
  onJump,
}: CheckCardProps) {
  if (tab === 'whitelist') {
    return (
      <Card as="section" aria-labelledby="config-check">
        <CardHeader
          title="Check"
          titleId="config-check"
          actions={whitelistIssues.length > 0 ? summaryPill(whitelistIssues) : null}
        />
        <CardBody className="grid gap-3">
          {whitelistIssues.length > 0 ? (
            <IssueList issues={whitelistIssues} onJump={(line) => onJump('whitelist', line)} />
          ) : (
            <p className="text-[13px] text-text-secondary">
              The whitelist is checked when you save it. Lines that are not valid are listed here
              with their line numbers, and nothing is saved until they are fixed.
            </p>
          )}
        </CardBody>
      </Card>
    );
  }
  const checked = status === 'checked';
  return (
    <Card as="section" aria-labelledby="config-check">
      <CardHeader
        title="Check"
        titleId="config-check"
        actions={checked ? summaryPill(issues) : null}
      />
      <CardBody className="grid gap-3">
        <div aria-live="polite" className="grid gap-3">
          {status === 'checking' ? (
            <>
              <p className="text-[13px] text-text-secondary">
                {progress && progress.total > 0
                  ? `Checking source ${formatInteger(progress.current)} of ${formatInteger(progress.total)}.`
                  : 'Checking the sources.'}
              </p>
              <ProgressBar
                thin
                tone="info"
                label="Sources checked"
                value={progress?.current ?? 0}
                max={progress?.total || 1}
              />
            </>
          ) : checked ? (
            <>
              {issues.length > 0 ? (
                <IssueList issues={issues} onJump={(line) => onJump('sources', line)} />
              ) : null}
              <p className="text-[13px] text-text-secondary">
                {checkedCount > 0
                  ? `${pluralise(checkedCount, 'source')} checked ${checkedAt === null ? '' : formatRelativeTime(new Date(checkedAt), now)}.`
                  : issues.length > 0
                    ? 'The sources were not contacted, because the file has errors.'
                    : 'There are no sources to check.'}
              </p>
            </>
          ) : (
            <p className="text-[13px] text-text-secondary">
              {status === 'outdated'
                ? 'The sources have changed since the last check.'
                : 'A check reads every line and asks each source whether it is reachable. Saving runs the same check.'}
            </p>
          )}
        </div>
        <div>
          <Button
            size="sm"
            icon="tick"
            loading={status === 'checking'}
            disabled={sourceCount === 0}
            onClick={onCheck}
          >
            {checked ? 'Check again' : 'Check sources'}
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
