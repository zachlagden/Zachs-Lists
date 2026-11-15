export const SITE_NAME = "Zach's Lists";
export const SITE_DESCRIPTION =
  "Zach's Lists builds one DNS blocklist from the sources you choose, removes the domains you whitelist, and publishes it for Pi-hole, AdGuard Home or your browser.";

export const REPOSITORY_URL = 'https://github.com/zachlagden/Zachs-Lists';
export const LICENCE_URL = `${REPOSITORY_URL}/blob/main/LICENSE`;
export const SPONSOR_URL = 'https://github.com/sponsors/zachlagden';
export const DEFAULT_SOURCES_URL = 'https://github.com/zachlagden/Pi-hole-Optimized-Blocklists';

export function resolveSiteUrl(configured: string | undefined, origin: string): string {
  const trimmed = (configured ?? '').trim().replace(/\/+$/, '');
  return trimmed || origin;
}

export const SITE_URL = resolveSiteUrl(
  import.meta.env.VITE_SITE_URL,
  typeof window === 'undefined' ? '' : window.location.origin,
);
