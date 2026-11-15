import { useQuery } from '@tanstack/react-query';
import type { Ref } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { jobsQuery, type JobsResponse } from '../../api/jobs';
import { cn } from '../../lib/cn';
import type { User } from '../../types';
import { Icon } from '../ui/Icon';
import { IconButton } from '../ui/IconButton';
import { Brand } from './Brand';
import {
  BUILDS_PATH,
  MAIN_NAV,
  MORE_NAV,
  buildsBadge,
  isNavActive,
  visibleNav,
  type NavItem,
} from './navigation';

function activeBuildsBadge(data: JobsResponse): string | null {
  return buildsBadge(data.jobs);
}

function NavLinkRow({
  item,
  pathname,
  onNavigate,
  badge,
}: {
  item: NavItem;
  pathname: string;
  onNavigate: () => void;
  badge?: string;
}) {
  const current = isNavActive(pathname, item.to);
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      aria-current={current ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-control px-2.5 py-2 font-medium no-underline narrow:min-h-11',
        current
          ? 'bg-surface-raised text-text shadow-[inset_2px_0_0_var(--accent-start)]'
          : 'text-text-secondary hover:bg-surface-hover hover:text-text',
      )}
    >
      <Icon name={item.icon} />
      {item.label}
      {badge ? (
        <span className="ml-auto rounded-full bg-info-soft px-[7px] py-px font-mono text-[11px] font-medium text-info">
          {badge}
        </span>
      ) : null}
    </Link>
  );
}

export interface SidebarProps {
  user: User;
  open: boolean;
  drawer: boolean;
  onNavigate: () => void;
  onSignOut: () => void;
  signingOut: boolean;
  ref?: Ref<HTMLElement>;
}

export function Sidebar({
  user,
  open,
  drawer,
  onNavigate,
  onSignOut,
  signingOut,
  ref,
}: SidebarProps) {
  const { pathname } = useLocation();
  const { data: badge = null } = useQuery({ ...jobsQuery(), select: activeBuildsBadge });
  const displayName = user.name || user.username;
  return (
    <aside
      ref={ref}
      id="app-sidebar"
      aria-label="Sidebar"
      inert={drawer && !open}
      className={cn(
        'sticky top-0 flex h-screen flex-col gap-1 overflow-y-auto overscroll-contain border-r border-border bg-sunken px-3 py-4',
        'narrow:fixed narrow:inset-y-0 narrow:left-0 narrow:z-20 narrow:w-[264px] narrow:transition-transform narrow:duration-200',
        open ? 'narrow:translate-x-0' : 'narrow:-translate-x-full',
      )}
    >
      <Brand to="/dashboard" className="px-2 pt-1.5 pb-[18px]" />
      <nav aria-label="Main">
        {MAIN_NAV.map((item) => (
          <NavLinkRow
            key={item.to}
            item={item}
            pathname={pathname}
            onNavigate={onNavigate}
            badge={item.to === BUILDS_PATH && badge ? badge : undefined}
          />
        ))}
        <div className="px-2.5 pt-3.5 pb-1.5 text-[11px] tracking-[0.06em] text-text-tertiary uppercase">
          More
        </div>
        {visibleNav(MORE_NAV, user.is_admin).map((item) => (
          <NavLinkRow key={item.to} item={item} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="mt-auto flex items-center gap-2.5 rounded-card border border-border bg-surface p-2.5">
        <span
          aria-hidden="true"
          className="grid size-[30px] flex-none place-items-center rounded-full border border-border-strong bg-surface-raised text-xs font-semibold"
        >
          {displayName.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate">{displayName}</div>
          <small className="block truncate font-mono text-xs text-text-tertiary" translate="no">
            {user.username}
          </small>
        </div>
        <IconButton
          label="Sign out"
          icon="sign-out"
          size="sm"
          onClick={onSignOut}
          disabled={signingOut}
        />
      </div>
    </aside>
  );
}
