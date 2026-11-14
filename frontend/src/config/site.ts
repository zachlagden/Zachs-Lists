/**
 * Site configuration - centralizes URL handling for development and production.
 */

export const SITE_URL = import.meta.env.VITE_SITE_URL || 'http://localhost:5173';
export const SITE_DOMAIN = new URL(SITE_URL).host;

/**
 * Get the URL for a default blocklist.
 */
export const getDefaultListUrl = (name: string): string => {
  return `${SITE_URL}/lists/${name}.txt`;
};

/**
 * Get the URL for a user's custom blocklist.
 */
export const getUserListUrl = (username: string, name: string): string => {
  return `${SITE_URL}/u/${username}/${name}.txt`;
};

/** Published Pi-hole v6 allowlist. Not a blocklist category. */
export const ALLOWLIST_NAME = 'allowlist';
export const ALLOWLIST_PRIMARY_FORMAT = 'adblock';

function allowlistUrl(base: string, format?: string): string {
  if (!format || format === ALLOWLIST_PRIMARY_FORMAT) {
    return base;
  }
  return `${base}?format=${format}`;
}

/** Bare URL. Adblock is the default format, so the subscription URL has no query. */
export const getUserAllowlistUrl = (username: string, format?: string): string => {
  return allowlistUrl(getUserListUrl(username, ALLOWLIST_NAME), format);
};

export const getDefaultAllowlistUrl = (format?: string): string => {
  return allowlistUrl(getDefaultListUrl(ALLOWLIST_NAME), format);
};
