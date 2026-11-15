import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { Icon } from '../../components/ui/Icon';
import { KeyValueList } from '../../components/ui/Layout';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { formatInteger, pluralise } from '../../lib/format';
import type { WhitelistPatternProgress, WhitelistProgress } from '../../types';
import { sentence } from '../../lib/text';

function Pattern({ pattern }: { pattern: WhitelistPatternProgress }) {
  return (
    <li className="border-b border-border py-2 last:border-b-0 last:pb-0">
      <div className="flex items-baseline gap-3">
        <code className="min-w-0 font-mono text-xs break-all">{pattern.pattern}</code>
        <span className="num ml-auto flex-none text-text-secondary">
          {formatInteger(pattern.match_count)} removed
        </span>
      </div>
      {pattern.samples.length > 0 ? (
        <p className="mt-1 font-mono text-xs break-all text-text-tertiary">
          <span className="font-sans">For example </span>
          {pattern.samples.join(', ')}
        </p>
      ) : null}
    </li>
  );
}

function Finished({ whitelist }: { whitelist: WhitelistProgress }) {
  return (
    <>
      <KeyValueList
        items={[
          { label: 'Domains removed', value: formatInteger(whitelist.total_removed) },
          { label: 'Patterns applied', value: formatInteger(whitelist.patterns_total) },
          { label: 'Domains checked', value: formatInteger(whitelist.domains_before) },
          { label: 'Domains left', value: formatInteger(whitelist.domains_after) },
        ]}
      />
      {whitelist.patterns.length > 0 ? (
        <details className="group mt-3">
          <summary className="flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-control text-[13px] text-text-secondary hover:text-text narrow:min-h-11 [&::-webkit-details-marker]:hidden">
            <Icon name="chevron-right" size={14} className="group-open:rotate-90" />
            {whitelist.patterns.length === 1
              ? 'The pattern that removed the most'
              : `The ${whitelist.patterns.length} patterns that removed the most`}
          </summary>
          <ul className="m-0 mt-1 list-none p-0">
            {whitelist.patterns.map((pattern) => (
              <Pattern key={`${pattern.pattern_type}:${pattern.pattern}`} pattern={pattern} />
            ))}
          </ul>
        </details>
      ) : null}
      {whitelist.warnings.length > 0 ? (
        <div className="mt-3 rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <p className="flex items-center gap-1.5 font-medium">
            <Icon name="warn" size={14} />
            {pluralise(whitelist.warnings.length, 'whitelist line')}{' '}
            {whitelist.warnings.length === 1 ? 'was' : 'were'} ignored
          </p>
          <ul className="m-0 mt-1 list-none p-0">
            {whitelist.warnings.map((warning) => (
              <li key={warning} className="break-words">
                {sentence(warning)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}

export interface WhitelistCardProps {
  whitelist: WhitelistProgress | null;
  running: boolean;
}

export function WhitelistCard({ whitelist, running }: WhitelistCardProps) {
  const state = !whitelist ? (running ? 'Waiting' : 'Not reached') : null;
  return (
    <Card as="section" aria-labelledby="build-whitelist">
      <CardHeader
        title="Whitelist"
        titleId="build-whitelist"
        actions={state ?? (whitelist?.processing ? 'Checking' : 'Done')}
      />
      <CardBody>
        {!whitelist ? (
          <p className="text-[13px] text-text-secondary">
            {running
              ? 'Whitelisted domains are removed once every source is in.'
              : 'The build ended before the whitelist was applied.'}
          </p>
        ) : whitelist.processing ? (
          <div className="grid gap-2">
            <div className="flex justify-between gap-3 text-[13px]">
              <span className="num">
                {formatInteger(whitelist.domains_checked)} of{' '}
                {formatInteger(whitelist.domains_before)} domains checked
              </span>
              <span className="num text-text-secondary">
                {formatInteger(whitelist.total_removed)} removed
              </span>
            </div>
            <ProgressBar
              thin
              tone="info"
              value={whitelist.domains_checked}
              max={Math.max(whitelist.domains_before, 1)}
              label="Domains checked against the whitelist"
            />
            <p className="text-xs text-text-tertiary">
              {pluralise(whitelist.patterns_total, 'pattern')} to apply
            </p>
          </div>
        ) : whitelist.patterns_total === 0 && whitelist.warnings.length === 0 ? (
          <p className="text-[13px] text-text-secondary">
            The whitelist has no patterns, so nothing was removed.
          </p>
        ) : (
          <Finished whitelist={whitelist} />
        )}
      </CardBody>
    </Card>
  );
}
