import { Button } from '../../components/ui/Button';
import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { StatusPill } from '../../components/ui/StatusPill';
import { EmptyState } from '../../components/ui/States';
import type { Job } from '../../types';
import { attentionItems } from './dashboardFacts';

export function NeedsAttention({ publishedBuild }: { publishedBuild: Job | null }) {
  const items = attentionItems(publishedBuild?.progress.sources ?? []);
  return (
    <Card as="section" aria-labelledby="needs-attention">
      <CardHeader
        title="Needs attention"
        titleId="needs-attention"
        actions={
          items.length > 0 ? (
            <StatusPill tone="warn">
              {items.length}
              <span className="sr-only"> {items.length === 1 ? 'source' : 'sources'}</span>
            </StatusPill>
          ) : null
        }
      />
      {items.length === 0 ? (
        <EmptyState title="Nothing needs attention" icon="check">
          {publishedBuild
            ? 'Every source downloaded in the published build.'
            : 'Sources that fail or fall back to an older copy are listed here after a build.'}
        </EmptyState>
      ) : (
        <CardBody>
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <li key={item.id} className="flex gap-3 border-b border-border py-3 first:pt-0">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium break-words">{item.name}</h3>
                  <p className="mt-0.5 text-[13px] break-words text-text-secondary">
                    {item.detail}
                  </p>
                </div>
                {item.kind === 'failed' ? (
                  <StatusPill tone="fail" icon="fail" className="ml-auto">
                    Failed
                  </StatusPill>
                ) : (
                  <StatusPill tone="warn" icon="warn" className="ml-auto">
                    Older copy
                  </StatusPill>
                )}
              </li>
            ))}
          </ul>
          <div className="pt-3">
            <Button to="/config" size="sm">
              Review sources
            </Button>
          </div>
        </CardBody>
      )}
    </Card>
  );
}
