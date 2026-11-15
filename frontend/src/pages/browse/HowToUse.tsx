import { Card, CardBody, CardHeader } from '../../components/ui/Card';
import { FORMAT_SAMPLES, LIST_FORMATS } from '../../lib/listCatalogue';
import type { ListFormat } from '../../types';

const FORMAT_DETAILS: Record<ListFormat, string> = {
  hosts:
    'Each line pairs the address 0.0.0.0 with one domain. This is the format served when an address has no format.',
  plain: 'Each line is one domain and nothing else.',
  adblock: 'Each line is a rule that blocks a domain and its subdomains.',
};

const BLOCKERS: ReadonlyArray<{ name: string; text: string }> = [
  {
    name: 'Pi-hole',
    text: 'Add the address as a blocklist in the admin interface, then update gravity so Pi-hole downloads it. Use the hosts format.',
  },
  {
    name: 'AdGuard Home',
    text: 'Add the address as a custom DNS blocklist in the filter settings. It reads the hosts and Adblock formats.',
  },
  {
    name: 'uBlock Origin',
    text: 'Add the address as a custom filter list in the settings of the extension. Use the Adblock format.',
  },
];

export function HowToUse() {
  return (
    <Card as="section" aria-labelledby="how-to-use">
      <CardHeader title="How to use a list" titleId="how-to-use" />
      <CardBody className="grid gap-5">
        <p className="max-w-[78ch] text-text-secondary">
          Pick the format your blocker reads, copy the address and add it to the blocker. The
          address stays the same after every rebuild, so the blocker gets the new version the next
          time it updates its lists.
        </p>
        <div className="grid grid-cols-3 gap-4 compact:grid-cols-1">
          {LIST_FORMATS.map((format) => (
            <div key={format.value} className="grid content-start gap-1.5">
              <h3 className="font-semibold">{format.label}</h3>
              <code
                translate="no"
                className="mono justify-self-start rounded-md border border-border bg-sunken px-2 py-1 break-all"
              >
                {FORMAT_SAMPLES[format.value]}
              </code>
              <p className="text-[13px] text-text-secondary">{FORMAT_DETAILS[format.value]}</p>
            </div>
          ))}
        </div>
        <dl className="grid grid-cols-3 gap-4 border-t border-border pt-5 compact:grid-cols-1">
          {BLOCKERS.map((blocker) => (
            <div key={blocker.name}>
              <dt className="font-semibold" translate="no">
                {blocker.name}
              </dt>
              <dd className="m-0 mt-0.5 text-[13px] text-text-secondary">{blocker.text}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}
