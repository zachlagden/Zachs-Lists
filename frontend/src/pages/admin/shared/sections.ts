export interface AdminSection {
  path: string;
  label: string;
  legacyTab: string;
}

export const ADMIN_SECTIONS: ReadonlyArray<AdminSection> = [
  { path: '/admin', label: 'Overview', legacyTab: 'overview' },
  { path: '/admin/users', label: 'Users', legacyTab: 'users' },
  { path: '/admin/limits', label: 'Limits', legacyTab: 'limits' },
  { path: '/admin/default-lists', label: 'Default lists', legacyTab: 'default' },
  { path: '/admin/featured', label: 'Featured lists', legacyTab: 'featured' },
  { path: '/admin/builds', label: 'Builds', legacyTab: 'jobs' },
  { path: '/admin/library', label: 'Source library', legacyTab: 'library' },
  { path: '/admin/announcements', label: 'Announcements', legacyTab: 'announcements' },
];

const BUILD_DETAIL_PREFIX = '/admin/jobs';

export function legacyTabPath(search: string): string | null {
  const tab = new URLSearchParams(search).get('tab');
  if (!tab) return null;
  return ADMIN_SECTIONS.find((section) => section.legacyTab === tab)?.path ?? '/admin';
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

export function activeSection(pathname: string): AdminSection {
  const current = withoutTrailingSlash(pathname);
  if (current === BUILD_DETAIL_PREFIX || current.startsWith(`${BUILD_DETAIL_PREFIX}/`)) {
    return ADMIN_SECTIONS[5];
  }
  const nested = ADMIN_SECTIONS.slice(1).find(
    (section) => current === section.path || current.startsWith(`${section.path}/`),
  );
  return nested ?? ADMIN_SECTIONS[0];
}

export function adminTitle(page: string): string {
  return `${page} · Admin`;
}
