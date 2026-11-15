import { Suspense } from 'react';
import { Link, Outlet } from 'react-router-dom';
import { LICENCE_URL, REPOSITORY_URL, SPONSOR_URL } from '../../config/site';
import { useAuthStore } from '../../store';
import { Button } from '../ui/Button';
import { ToastRegion } from '../ui/ToastRegion';
import { Brand } from './Brand';
import { NavigationProgress, PagePending } from './Pending';
import { SkipLink } from './SkipLink';
import { ThemeToggle } from './ThemeToggle';

const FOOTER_LINK =
  'text-text-secondary underline underline-offset-2 hover:text-text narrow:inline-block narrow:py-3';

function AccountAction() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (isLoading) return <span aria-hidden="true" className="h-9 w-[158px] narrow:h-11" />;
  return isAuthenticated ? (
    <Button to="/dashboard" variant="primary">
      Open dashboard
    </Button>
  ) : (
    <Button to="/login" variant="primary">
      Sign in with GitHub
    </Button>
  );
}

function PublicFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1160px] px-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border py-6 text-[13px] text-text-tertiary">
        <p className="mr-auto">
          Zach's Lists is open source under the{' '}
          <a href={LICENCE_URL} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
            MIT licence
          </a>
          .
        </p>
        <nav aria-label="Project links" className="flex flex-wrap gap-x-5 gap-y-1">
          <Link to="/browse" className={FOOTER_LINK}>
            Default lists
          </Link>
          <a
            href={REPOSITORY_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={FOOTER_LINK}
          >
            Source on GitHub
          </a>
          <a href={SPONSOR_URL} target="_blank" rel="noopener noreferrer" className={FOOTER_LINK}>
            Sponsor
          </a>
        </nav>
      </div>
    </footer>
  );
}

export function PublicShell() {
  return (
    <div className="flex min-h-screen flex-col bg-glow bg-no-repeat">
      <SkipLink />
      <NavigationProgress />
      <div className="mx-auto w-full max-w-[1160px] px-6">
        <header className="flex items-center gap-2 py-[18px]">
          <Brand to="/" />
          <span className="flex-1" />
          <Button to="/browse" variant="ghost" className="narrow:hidden">
            Default lists
          </Button>
          <ThemeToggle />
          <AccountAction />
        </header>
      </div>
      <main id="content" tabIndex={-1} className="w-full flex-1 outline-none">
        <Suspense fallback={<PagePending />}>
          <Outlet />
        </Suspense>
      </main>
      <PublicFooter />
      <ToastRegion />
    </div>
  );
}
