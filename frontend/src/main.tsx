import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-500.css';
import './styles/index.css';
import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from './api/queryClient';
import { router } from './router';
import { takeReturnPath } from './routes/returnPath';
import { startSession, watchForExpiredSession } from './session';

const SIGN_IN_LANDING_PATH = '/dashboard';

watchForExpiredSession();

void startSession().then((user) => {
  const returnPath = takeReturnPath();
  if (user && returnPath && window.location.pathname === SIGN_IN_LANDING_PATH) {
    void router.navigate(returnPath, { replace: true });
  }
});

const root = document.getElementById('root');
if (!root) throw new Error('The page is missing its root element.');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
