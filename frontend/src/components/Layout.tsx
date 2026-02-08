import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAuthStore, useJobsStore } from '../store';
import { authApi } from '../api/client';
import { SITE_DOMAIN } from '../config/site';

interface LayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
  { path: '/config', label: 'Configuration', icon: ConfigIcon },
  { path: '/lists', label: 'My Lists', icon: ListIcon },
  { path: '/jobs', label: 'Jobs', icon: JobsIcon },
];

const adminItems = [{ path: '/admin', label: 'Admin', icon: AdminIcon }];

export default function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { hasUnreadFailures } = useJobsStore();

  const handleLogout = async () => {
    try {
      await authApi.logout();
      logout();
      window.location.href = '/';
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return (
    <div className="min-h-screen bg-pihole-darkest flex">
      {/* Sidebar */}
      <aside className="w-64 bg-pihole-darker border-r border-pihole-border flex flex-col">
        {/* Logo */}
        <div className="p-6 border-b border-pihole-border">
          <Link to="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-pihole-accent rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">ZL</span>
            </div>
            <div>
              <h1 className="font-bold text-pihole-text">Zach's Lists</h1>
              <p className="text-xs text-pihole-text-muted">{SITE_DOMAIN}</p>
            </div>
          </Link>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              const showBadge = item.path === '/jobs' && hasUnreadFailures;

              return (
                <li key={item.path}>
                  <Link
                    to={item.path}
                    className={clsx(
                      'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
                      isActive
                        ? 'bg-pihole-accent text-white'
                        : 'text-pihole-text-muted hover:text-pihole-text hover:bg-pihole-border',
                    )}
                  >
                    <item.icon className="w-5 h-5" />
                    <span>{item.label}</span>
                    {showBadge && (
                      <span className="ml-auto w-2 h-2 bg-pihole-accent rounded-full" />
                    )}
                  </Link>
                </li>
              );
            })}

            {/* Admin items */}
            {user?.is_admin && (
              <>
                <li className="pt-4">
                  <div className="px-4 py-2 text-xs font-semibold text-pihole-text-muted uppercase tracking-wider">
                    Admin
                  </div>
                </li>
                {adminItems.map((item) => {
                  const isActive = location.pathname === item.path;
                  return (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        className={clsx(
                          'flex items-center gap-3 px-4 py-2.5 rounded-lg transition-colors',
                          isActive
                            ? 'bg-pihole-accent text-white'
                            : 'text-pihole-text-muted hover:text-pihole-text hover:bg-pihole-border',
                        )}
                      >
                        <item.icon className="w-5 h-5" />
                        <span>{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </>
            )}
          </ul>
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-pihole-border">
          <div className="flex items-center gap-3 mb-3">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.username} className="w-10 h-10 rounded-full" />
            ) : (
              <div className="w-10 h-10 bg-pihole-border rounded-full flex items-center justify-center">
                <span className="text-pihole-text font-medium">
                  {user?.username?.[0]?.toUpperCase()}
                </span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium text-pihole-text truncate">{user?.username}</p>
              <p className="text-xs text-pihole-text-muted truncate">{user?.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="w-full btn btn-ghost text-sm justify-center">
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="p-8">{children}</div>
      </main>
    </div>
  );
}

// Icons
function DashboardIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"
      />
    </svg>
  );
}

function ConfigIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
      />
    </svg>
  );
}

function JobsIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  );
}

function AdminIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
      />
    </svg>
  );
}
