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
import { returnPathOnArrival } from './routes/returnPath';
import { onSessionExpired, startSession, watchForExpiredSession } from './session';

watchForExpiredSession();
onSessionExpired((from) => {
  void router.navigate('/login', { replace: true, state: { from } });
});

void startSession().then((user) => {
  const returnPath = returnPathOnArrival(user !== null, window.location.pathname);
  if (returnPath) void router.navigate(returnPath, { replace: true });
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
