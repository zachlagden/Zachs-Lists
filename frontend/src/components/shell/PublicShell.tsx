import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useAuthStore } from '../../store';
import { Button } from '../ui/Button';
import { ToastRegion } from '../ui/ToastRegion';
import { Brand } from './Brand';
import { NavigationProgress, PagePending } from './Pending';
import { SkipLink } from './SkipLink';
import { ThemeToggle } from './ThemeToggle';

export function PublicShell() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return (
    <div className="min-h-screen bg-glow bg-no-repeat">
      <SkipLink />
      <NavigationProgress />
      <div className="mx-auto max-w-[1160px] px-6">
        <header className="flex items-center gap-2 py-[18px]">
          <Brand to="/" />
          <span className="flex-1" />
          <Button to="/browse" variant="ghost" className="narrow:hidden">
            Default lists
          </Button>
          <ThemeToggle />
          {isAuthenticated ? (
            <Button to="/dashboard" variant="primary">
              Dashboard
            </Button>
          ) : (
            <Button to="/login" variant="primary">
              Sign in with GitHub
            </Button>
          )}
        </header>
      </div>
      <main id="content" tabIndex={-1} className="outline-none">
        <Suspense fallback={<PagePending />}>
          <Outlet />
        </Suspense>
      </main>
      <ToastRegion />
    </div>
  );
}
