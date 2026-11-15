import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { PagePending } from './components/shell/Pending';
import { PublicShell } from './components/shell/PublicShell';
import HomePage from './pages/home/HomePage';
import { RequireAdmin, RequireAuth } from './routes/guards';
import { RouteError } from './routes/RouteError';

type PageModule = { default: ComponentType };

function page(load: () => Promise<PageModule>): RouteObject['lazy'] {
  return async () => ({ Component: (await load()).default });
}

const developmentRoutes: RouteObject[] = import.meta.env.DEV
  ? [{ path: 'dev/components', lazy: page(() => import('./pages/dev/ComponentsPage')) }]
  : [];

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError fullScreen />,
    hydrateFallbackElement: <PagePending fullScreen />,
    children: [
      {
        element: <PublicShell />,
        children: [
          {
            errorElement: <RouteError />,
            children: [
              { index: true, element: <HomePage /> },
              { path: 'login', lazy: page(() => import('./pages/LoginPage')) },
              { path: 'browse', lazy: page(() => import('./pages/browse/BrowsePage')) },
              ...developmentRoutes,
              { path: '*', lazy: page(() => import('./pages/NotFoundPage')) },
            ],
          },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            lazy: async () => ({
              Component: (await import('./components/shell/AppShell')).AppShell,
            }),
            children: [
              {
                errorElement: <RouteError />,
                children: [
                  {
                    path: 'dashboard',
                    lazy: page(() => import('./pages/dashboard/DashboardPage')),
                  },
                  { path: 'config', lazy: page(() => import('./pages/config/ConfigPage')) },
                  { path: 'lists', lazy: page(() => import('./pages/lists/ListsPage')) },
                  { path: 'jobs', lazy: page(() => import('./pages/builds/BuildHistoryPage')) },
                  { path: 'jobs/:jobId', lazy: page(() => import('./pages/builds/BuildPage')) },
                  {
                    element: <RequireAdmin />,
                    children: [
                      {
                        path: 'admin',
                        lazy: page(() => import('./pages/admin/AdminLayout')),
                        children: [
                          {
                            index: true,
                            lazy: page(() => import('./pages/admin/overview/OverviewPage')),
                          },
                          {
                            path: 'users',
                            lazy: page(() => import('./pages/admin/users/UsersPage')),
                          },
                          {
                            path: 'users/:userId',
                            lazy: page(() => import('./pages/admin/users/detail/UserDetailPage')),
                          },
                          {
                            path: 'limits',
                            lazy: page(() => import('./pages/admin/limits/LimitsPage')),
                          },
                          {
                            path: 'default-lists',
                            lazy: page(
                              () => import('./pages/admin/default-lists/DefaultListsPage'),
                            ),
                          },
                          {
                            path: 'featured',
                            lazy: page(() => import('./pages/admin/featured/FeaturedPage')),
                          },
                          {
                            path: 'builds',
                            lazy: page(() => import('./pages/admin/builds/BuildsPage')),
                          },
                          {
                            path: 'library',
                            lazy: page(() => import('./pages/admin/library/LibraryPage')),
                          },
                          {
                            path: 'announcements',
                            lazy: page(
                              () => import('./pages/admin/announcements/AnnouncementsPage'),
                            ),
                          },
                          {
                            path: 'jobs/:jobId',
                            lazy: page(() => import('./pages/builds/AdminBuildPage')),
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
