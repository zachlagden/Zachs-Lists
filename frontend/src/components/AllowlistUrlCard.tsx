import { useState } from 'react';
import { getUserAllowlistUrl } from '../config/site';

interface AllowlistUrlCardProps {
  username: string;
}

export default function AllowlistUrlCard({ username }: AllowlistUrlCardProps) {
  const adblockUrl = getUserAllowlistUrl(username);
  const plainUrl = getUserAllowlistUrl(username, 'plain');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copy = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="text-lg font-semibold text-pihole-text">Pi-hole v6 allowlist</h3>
        <p className="text-sm text-yellow-500 mt-1">
          This URL is world-readable. On a public instance anyone can download your whitelist.
        </p>
        <p className="text-sm text-pihole-text-muted mt-1">
          Add the adblock URL in Pi-hole v6 as an allow-type adlist. Plain format lists exact
          domains only and does not honor subdomain semantics.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 bg-pihole-darkest border border-pihole-border rounded px-3 py-2 text-sm text-pihole-text-muted overflow-x-auto">
          {adblockUrl}
        </code>
        <button
          type="button"
          onClick={() => copy(adblockUrl)}
          className="btn btn-ghost text-sm shrink-0"
        >
          {copiedUrl === adblockUrl ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <button type="button" onClick={() => copy(plainUrl)} className="btn btn-ghost text-xs">
        {copiedUrl === plainUrl ? 'Copied!' : 'Copy plain URL'}
      </button>
    </div>
  );
}
