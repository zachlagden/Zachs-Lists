import type { ComponentType } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';
import { AppShell } from './components/shell/AppShell';
import { PagePending } from './components/shell/Pending';
import { PublicShell } from './components/shell/PublicShell';
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
              { index: true, lazy: page(() => import('./pages/home/HomePage')) },
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
            element: <AppShell />,
            children: [
              {
                errorElement: <RouteError />,
                children: [
                  {
                    path: 'dashboard',
                    lazy: page(() => import('./pages/dashboard/DashboardPage')),
                  },
                  { path: 'config', lazy: page(() => import('./pages/ConfigPage')) },
                  { path: 'lists', lazy: page(() => import('./pages/lists/ListsPage')) },
                  { path: 'jobs', lazy: page(() => import('./pages/JobsPage')) },
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
                            lazy: page(() => import('./pages/AdminJobDetailPage')),
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
