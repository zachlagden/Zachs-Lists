/**
 * Site configuration - centralizes URL handling for development and production.
 */

export const SITE_URL = import.meta.env.VITE_SITE_URL || 'http://localhost:5173';
export const SITE_DOMAIN = new URL(SITE_URL).host;

/**
 * Get the URL for a default blocklist.
 */
export const getDefaultListUrl = (name: string): string => {
  return `${SITE_URL}/api/lists/${name}.txt`;
};

/**
 * Get the URL for a user's custom blocklist.
 */
export const getUserListUrl = (username: string, name: string): string => {
  return `${SITE_URL}/api/u/${username}/${name}.txt`;
};
