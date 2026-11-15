import type { JobStatus } from '../../types';
import type { IconName } from '../ui/icons';

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  adminOnly?: boolean;
}

export const MAIN_NAV: ReadonlyArray<NavItem> = [
  { to: '/dashboard', label: 'Dashboard', icon: 'home' },
  { to: '/config', label: 'Configuration', icon: 'sliders' },
  { to: '/jobs', label: 'Builds', icon: 'bolt' },
  { to: '/lists', label: 'My lists', icon: 'list' },
];

export const MORE_NAV: ReadonlyArray<NavItem> = [
  { to: '/admin', label: 'Admin', icon: 'shield', adminOnly: true },
  { to: '/browse', label: 'Browse default lists', icon: 'globe' },
];

export const BUILDS_PATH = '/jobs';

export function isNavActive(pathname: string, to: string): boolean {
  const current = pathname.replace(/\/+$/, '') || '/';
  return current === to || current.startsWith(`${to}/`);
}

export interface Breadcrumb {
  label: string;
  to?: string;
}

const PAGE_TITLES: Record<string, string> = {
  dashboard: 'Dashboard',
  config: 'Configuration',
  jobs: 'Builds',
  lists: 'My lists',
  admin: 'Admin',
  dev: 'Development',
};

const ADMIN_DETAIL_TITLES: Record<string, string> = {
  users: 'User',
  jobs: 'Build',
};

const ADMIN_SECTION_TITLES: Record<string, string> = {
  users: 'Users',
  limits: 'Limits',
  'default-lists': 'Default lists',
  featured: 'Featured lists',
  builds: 'Builds',
  library: 'Source library',
  announcements: 'Announcements',
};

export function breadcrumbsFor(pathname: string): Breadcrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const [first, second] = segments;
  if (!first) return [];
  const root = PAGE_TITLES[first] ?? 'Page not found';
  if (first === 'admin' && second) {
    const section = segments.length === 2 ? ADMIN_SECTION_TITLES[second] : undefined;
    return [
      { label: root, to: '/admin' },
      { label: section ?? ADMIN_DETAIL_TITLES[second] ?? 'Details' },
    ];
  }
  if (first === 'jobs' && second) {
    return [{ label: root, to: BUILDS_PATH }, { label: 'Build' }];
  }
  if (first === 'dev' && second === 'components') {
    return [{ label: root }, { label: 'Components' }];
  }
  return [{ label: root }];
}

export function visibleNav(items: ReadonlyArray<NavItem>, isAdmin: boolean): NavItem[] {
  return items.filter((item) => !item.adminOnly || isAdmin);
}

export function buildsBadge(jobs: ReadonlyArray<{ status: JobStatus }>): string | null {
  const building = jobs.filter((job) => job.status === 'processing').length;
  if (building > 0) return `${building} building`;
  const queued = jobs.filter((job) => job.status === 'queued').length;
  return queued > 0 ? `${queued} queued` : null;
}
