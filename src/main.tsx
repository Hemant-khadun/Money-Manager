import '@fontsource-variable/inter';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './app/router';
import { applyTheme, savedTheme } from './app/theme';
import { ensureSeeded } from './db/seed';
import './index.css';

applyTheme(savedTheme());

// The default categories exist before the first screen asks for them.
void ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
