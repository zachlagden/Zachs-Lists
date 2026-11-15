import type { Ref } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ConnectionIndicator } from '../ui/ConnectionBanner';
import { IconButton } from '../ui/IconButton';
import { breadcrumbsFor } from './navigation';
import { ThemeToggle } from './ThemeToggle';

export interface TopBarProps {
  drawerOpen: boolean;
  onToggleDrawer: () => void;
  menuButtonRef?: Ref<HTMLButtonElement>;
}

export function TopBar({ drawerOpen, onToggleDrawer, menuButtonRef }: TopBarProps) {
  const { pathname } = useLocation();
  const crumbs = breadcrumbsFor(pathname);
  return (
    <header className="sticky top-0 z-[5] flex items-center gap-3 border-b border-border bg-[color-mix(in_srgb,var(--background)_82%,transparent)] px-8 py-3.5 backdrop-blur-[10px] narrow:px-4 narrow:py-2.5">
      <span className="hidden narrow:inline-flex">
        <IconButton
          ref={menuButtonRef}
          label={drawerOpen ? 'Close menu' : 'Open menu'}
          icon="menu"
          aria-controls="app-sidebar"
          aria-expanded={drawerOpen}
          onClick={onToggleDrawer}
        />
      </span>
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="m-0 flex min-w-0 list-none items-center gap-2 p-0 text-[13px] text-text-tertiary">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li key={crumb.label} className="flex min-w-0 items-center gap-2">
                {index > 0 ? <span aria-hidden="true">/</span> : null}
                {crumb.to && !last ? (
                  <Link
                    to={crumb.to}
                    className="inline-flex items-center no-underline hover:text-text narrow:min-h-11 narrow:min-w-11"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={last ? 'page' : undefined}
                    className={last ? 'truncate font-medium text-text' : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <span className="flex-1" />
      <ConnectionIndicator className="narrow:hidden" />
      <ThemeToggle />
    </header>
  );
}
