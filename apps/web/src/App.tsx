import { RouterProvider } from 'react-router-dom';
import { useState } from 'react';

import { createAppQueryClient } from './app/query-client.js';
import { AppProviders } from './app/providers.js';
import { createAppRouter } from './app/router.js';

type AppProps = {
  router?: ReturnType<typeof createAppRouter>;
};

export function App({ router }: AppProps) {
  const [queryClient] = useState(() => createAppQueryClient());
  const [appRouter] = useState(() => router ?? createAppRouter());

  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={appRouter} />
    </AppProviders>
  );
}

export default App;
