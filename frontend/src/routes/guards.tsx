import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { PagePending } from '../components/shell/Pending';
import { useAuthStore } from '../store';

export function RequireAuth() {
  const isLoading = useAuthStore((state) => state.isLoading);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const location = useLocation();
  if (isLoading) return <PagePending fullScreen />;
  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: `${location.pathname}${location.search}${location.hash}` }}
      />
    );
  }
  return <Outlet />;
}

export function RequireAdmin() {
  const isAdmin = useAuthStore((state) => state.user?.is_admin ?? false);
  if (!isAdmin) return <Navigate to="/dashboard" replace />;
  return <Outlet />;
}
