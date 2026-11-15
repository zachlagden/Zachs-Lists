import { Card } from '../../components/ui/Card';
import { INLINE_LINK } from '../../components/ui/linkClasses';
import { REPOSITORY_URL, SPONSOR_URL } from '../../config/site';
import { REBUILD_SCHEDULE } from '../../lib/listCatalogue';

const FEATURES: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: 'Pick your sources',
    text: 'Choose from a library of public lists or paste the address of any list.',
  },
  {
    title: 'Keep what you need',
    text: 'Whitelist exact domains, wildcards or regular expressions.',
  },
  {
    title: 'Watch it build',
    text: 'See each source download and each stage finish as the build runs.',
  },
  {
    title: 'Three formats',
    text: 'Hosts, plain domains and Adblock rules, at addresses that never change.',
  },
];

const STEPS: ReadonlyArray<{ title: string; text: string }> = [
  {
    title: 'Choose your sources',
    text: 'Sign in with GitHub, then pick blocklists from the library or add the address of any public list.',
  },
  {
    title: 'Whitelist what must keep working',
    text: 'List the domains you rely on. They are removed from every list you publish.',
  },
  {
    title: 'Build',
    text: `A worker written in Rust downloads your sources in parallel, removes duplicates and whitelisted domains, and publishes the result. Your sources are checked again ${REBUILD_SCHEDULE}, and the list is rebuilt when one has changed.`,
  },
  {
    title: 'Add the address to your blocker',
    text: 'Copy the address of your list into your blocker once. It stays the same after every rebuild.',
  },
];

export function WhatItDoes() {
  return (
    <section
      aria-label="What it does"
      className="mb-14 grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4"
    >
      {FEATURES.map((feature) => (
        <Card key={feature.title} className="p-5">
          <h2 className="mb-1 text-[15px] font-semibold">{feature.title}</h2>
          <p className="text-text-secondary">{feature.text}</p>
        </Card>
      ))}
    </section>
  );
}

export function HowItWorks() {
  return (
    <section aria-labelledby="how-it-works" className="mb-14">
      <h2 id="how-it-works" className="mb-4 text-xl font-semibold tracking-[-0.01em]">
        How it works
      </h2>
      <ol className="grid grid-cols-4 gap-4 compact:grid-cols-2 narrow:grid-cols-1!">
        {STEPS.map((step, index) => (
          <li key={step.title} className="flex gap-3">
            <span
              aria-hidden="true"
              className="num grid size-7 flex-none place-items-center rounded-full bg-surface-raised text-[13px] font-semibold text-text-secondary"
            >
              {index + 1}
            </span>
            <div>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="mt-0.5 text-text-secondary">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Closing() {
  return (
    <section aria-label="Compatibility and source code" className="mt-8 mb-[72px] grid gap-2">
      <p className="max-w-[78ch] text-text-secondary">
        Works with any blocker that takes a list address in the hosts, plain domain or Adblock
        format, such as Pi-hole, AdGuard Home and uBlock Origin.
      </p>
      <p className="max-w-[78ch] text-text-secondary">
        Zach's Lists is free to use and open source under the MIT licence. Read the{' '}
        <a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
          source on GitHub
        </a>
        , or{' '}
        <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" className={INLINE_LINK}>
          sponsor the project
        </a>
        .
      </p>
    </section>
  );
}
