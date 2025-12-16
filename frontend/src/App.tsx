import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuthStore } from './store';
import { authApi } from './api/client';

// Pages
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import ConfigPage from './pages/ConfigPage';
import ListsPage from './pages/ListsPage';
import JobsPage from './pages/JobsPage';
import BrowsePage from './pages/BrowsePage';
import AdminPage from './pages/AdminPage';
import AdminUserDetailPage from './pages/AdminUserDetailPage';
import AdminJobDetailPage from './pages/AdminJobDetailPage';

// Layout
import Layout from './components/Layout';
import LoadingSpinner from './components/LoadingSpinner';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Admin route wrapper
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (!user?.is_admin) {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const { setUser, setLoading } = useAuthStore();

  useEffect(() => {
    // Check auth status on mount
    const checkAuth = async () => {
      try {
        const user = await authApi.getMe();
        setUser(user);
      } catch {
        setUser(null);
      }
    };

    checkAuth();
  }, [setUser, setLoading]);

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/browse" element={<BrowsePage />} />

      {/* Protected routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Layout>
              <DashboardPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/config"
        element={
          <ProtectedRoute>
            <Layout>
              <ConfigPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/lists"
        element={
          <ProtectedRoute>
            <Layout>
              <ListsPage />
            </Layout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/jobs"
        element={
          <ProtectedRoute>
            <Layout>
              <JobsPage />
            </Layout>
          </ProtectedRoute>
        }
      />

      {/* Admin routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminRoute>
              <Layout>
                <AdminPage />
              </Layout>
            </AdminRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/users/:userId"
        element={
          <ProtectedRoute>
            <AdminRoute>
              <Layout>
                <AdminUserDetailPage />
              </Layout>
            </AdminRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/jobs/:jobId"
        element={
          <ProtectedRoute>
            <AdminRoute>
              <Layout>
                <AdminJobDetailPage />
              </Layout>
            </AdminRoute>
          </ProtectedRoute>
        }
      />

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
