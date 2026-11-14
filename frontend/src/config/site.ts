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

export const getUserAllowlistUrl = (
  username: string,
  format: string = ALLOWLIST_PRIMARY_FORMAT,
): string => {
  return `${getUserListUrl(username, ALLOWLIST_NAME)}?format=${format}`;
};

export const getDefaultAllowlistUrl = (format: string = ALLOWLIST_PRIMARY_FORMAT): string => {
  return `${getDefaultListUrl(ALLOWLIST_NAME)}?format=${format}`;
};
