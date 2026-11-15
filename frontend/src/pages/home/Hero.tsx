import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { CopyButton } from '../../components/ui/CopyButton';
import { StatusPill } from '../../components/ui/StatusPill';
import { SITE_URL } from '../../config/site';
import { COMBINED_LIST, defaultListAddress, heroCountLine } from '../../lib/listCatalogue';
import type { DefaultList } from '../../types';

export interface HeroProps {
  isAuthenticated: boolean;
  defaultLists: DefaultList[] | undefined;
}

export function Hero({ isAuthenticated, defaultLists }: HeroProps) {
  const address = defaultListAddress(SITE_URL, COMBINED_LIST);
  return (
    <section className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-12 pt-[72px] pb-20 narrow:grid-cols-[minmax(0,1fr)] narrow:gap-7 narrow:pt-10 narrow:pb-14">
      <div>
        <StatusPill icon="bolt">Built by a Rust worker, rebuilt every week</StatusPill>
        <h1 className="mt-[18px] text-[clamp(34px,5vw,56px)] leading-[1.05] font-semibold tracking-[-0.03em] text-balance">
          One blocklist, built from the sources{' '}
          <span className="bg-accent bg-clip-text text-transparent">you choose</span>.
        </h1>
        <p className="mt-[18px] mb-[26px] max-w-[48ch] text-[17px] text-text-secondary">
          Combine public blocklists, remove the domains you need to keep working, and get one
          address for Pi-hole, AdGuard Home or your browser.
        </p>
        <div className="flex flex-wrap gap-2.5">
          {isAuthenticated ? (
            <Button to="/dashboard" variant="primary" size="lg">
              Open dashboard
            </Button>
          ) : (
            <Button to="/login" variant="primary" size="lg">
              Build your list
            </Button>
          )}
          <Button href="#lists" size="lg">
            Use a default list
          </Button>
        </div>
      </div>
      <Card>
        <div className="flex items-center gap-1.5 border-b border-border px-4 py-3 font-mono text-xs text-text-tertiary">
          <i aria-hidden="true" className="size-2.5 rounded-full bg-border-strong" />
          <i aria-hidden="true" className="size-2.5 rounded-full bg-border-strong" />
          <i aria-hidden="true" className="size-2.5 rounded-full bg-border-strong" />
          <span className="ml-2" translate="no">
            {COMBINED_LIST}.txt
          </span>
        </div>
        <div className="px-[18px] py-4 font-mono text-[13px] leading-[1.9] break-words text-text-tertiary">
          <p># Add this address to your blocker</p>
          <p className="text-ok" translate="no">
            {address}
          </p>
          <p className="num">{heroCountLine(defaultLists)}</p>
        </div>
        <div className="px-4 pb-4">
          <CopyButton
            text={address}
            label="Copy address"
            subject={`of the ${COMBINED_LIST} default list`}
            size="md"
            fullWidth
          />
        </div>
      </Card>
    </section>
  );
}
