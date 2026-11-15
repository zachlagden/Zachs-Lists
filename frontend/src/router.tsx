import type { ComponentType } from 'react';
import { createBrowserRouter, Outlet, type RouteObject } from 'react-router-dom';
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
              { index: true, lazy: page(() => import('./pages/HomePage')) },
              { path: 'login', lazy: page(() => import('./pages/LoginPage')) },
              { path: 'browse', lazy: page(() => import('./pages/BrowsePage')) },
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
                  { path: 'lists', lazy: page(() => import('./pages/ListsPage')) },
                  { path: 'jobs', lazy: page(() => import('./pages/JobsPage')) },
                  {
                    element: <RequireAdmin />,
                    children: [
                      {
                        path: 'admin',
                        element: <Outlet />,
                        children: [
                          { index: true, lazy: page(() => import('./pages/AdminPage')) },
                          {
                            path: 'users/:userId',
                            lazy: page(() => import('./pages/AdminUserDetailPage')),
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
