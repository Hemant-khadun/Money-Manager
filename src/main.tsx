import '@fontsource-variable/inter';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './app/router';
import { applyTheme, savedTheme } from './app/theme';
import { ensureSeeded } from './db/seed';
import { describeError } from './lib/describe-error';
import { debugLog } from './lib/debug-log';
import { restartedWhileReading } from './pipeline/care';
import './index.css';

applyTheme(savedTheme());

// For the problem report (#/debug). "App opened" right after "Page hidden", with no "Page shown"
// between, means the phone closed the page while it was away (often the camera, short of memory).
debugLog('app', `App opened (version ${__APP_VERSION__})`);
restartedWhileReading();
addEventListener('error', (event) => debugLog('app', `Uncaught: ${event.message}${event.filename ? ` (${event.filename.split('/').pop()}:${event.lineno})` : ''}`));
addEventListener('unhandledrejection', (event) => debugLog('app', `Unhandled: ${describeError(event.reason)}`));
document.addEventListener('visibilitychange', () => debugLog('app', document.hidden ? 'Page hidden' : 'Page shown'));

// The default categories exist before the first screen asks for them.
void ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
});
