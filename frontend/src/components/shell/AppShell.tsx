import { Suspense, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useJobsLiveSync } from '../../realtime/useJobsLiveSync';
import { signOutOfSession } from '../../session';
import { useAuthStore } from '../../store';
import { ConnectionBanner } from '../ui/ConnectionBanner';
import { ToastRegion } from '../ui/ToastRegion';
import { NavigationProgress, PagePending } from './Pending';
import { Sidebar } from './Sidebar';
import { SkipLink } from './SkipLink';
import { TopBar } from './TopBar';
import { NARROW_QUERY, useMediaQuery } from './useMediaQuery';

export function AppShell() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const narrow = useMediaQuery(NARROW_QUERY);
  const [drawerRequested, setDrawerRequested] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const drawerOpen = narrow && drawerRequested;

  useJobsLiveSync(user?.id);

  useEffect(() => {
    if (!drawerOpen) return;
    const menuButton = menuButtonRef.current;
    const sidebar = sidebarRef.current;
    const firstLink =
      sidebar?.querySelector<HTMLElement>('a[aria-current="page"]') ??
      sidebar?.querySelector<HTMLElement>('a');
    firstLink?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerRequested(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      menuButton?.focus();
    };
  }, [drawerOpen]);

  if (!user) return null;

  const closeDrawer = () => setDrawerRequested(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    const reachedServer = await signOutOfSession();
    navigate(reachedServer ? '/' : '/login?error=logout_failed', { replace: true });
  };

  return (
    <div className="grid min-h-screen grid-cols-[240px_minmax(0,1fr)] narrow:grid-cols-[minmax(0,1fr)]">
      <SkipLink />
      <Sidebar
        ref={sidebarRef}
        user={user}
        open={drawerOpen}
        drawer={narrow}
        onNavigate={closeDrawer}
        onSignOut={handleSignOut}
        signingOut={signingOut}
      />
      {drawerOpen ? (
        <div
          aria-hidden="true"
          onClick={closeDrawer}
          className="fixed inset-0 z-[19] bg-black/55"
        />
      ) : null}
      <div className="min-w-0 bg-glow bg-no-repeat">
        <TopBar
          drawerOpen={drawerOpen}
          onToggleDrawer={() => setDrawerRequested((open) => !open)}
          menuButtonRef={menuButtonRef}
        />
        <NavigationProgress />
        <main
          id="content"
          tabIndex={-1}
          inert={drawerOpen}
          className="max-w-[1240px] px-8 pt-7 pb-16 outline-none narrow:px-4 narrow:pt-5 narrow:pb-14"
        >
          <ConnectionBanner />
          <Suspense fallback={<PagePending />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      <ToastRegion />
    </div>
  );
}
