import { Outlet, createHashHistory, createRootRoute, createRoute, createRouter, lazyRouteComponent, useLocation } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { TabBar } from '../components/TabBar';
import { ToastProvider } from '../components/Toast';
import { Overview } from '../routes/Overview';
import { AppProvider, useApp } from './AppContext';

// Hash routes (/#/history) work on any static host, GitHub Pages included (docs/PLAN.md §11).
// Overview opens with the app; every other screen loads the first time it is visited.

const ReadingTest = lazy(() => import('../spike/SpikePage').then((m) => ({ default: m.SpikePage })));
const AddExpenseSheet = lazy(() => import('../routes/AddExpenseSheet').then((m) => ({ default: m.AddExpenseSheet })));
const UpdateBar = lazy(() => import('../components/UpdateBar'));

function Shell() {
  const { reader, addExpenseOpen } = useApp();
  const [sheetUsed, setSheetUsed] = useState(false);
  if (addExpenseOpen && !sheetUsed) setSheetUsed(true);
  const onTest = useLocation({ select: (l) => l.pathname.startsWith('/test') });
  const ready = reader.scans.filter((s) => s.status === 'done').length;
  const reading = reader.scans.some((s) => s.status === 'queued' || s.status === 'reading');
  return (
    <>
      {/* The page the sheets scale back. */}
      <div data-vaul-drawer-wrapper="" className="min-h-dvh bg-background">
        <Outlet />
      </div>
      {!onTest && <TabBar readyCount={ready} />}
      <Suspense fallback={null}>
        <UpdateBar reading={reading} />
      </Suspense>
      {sheetUsed && (
        <Suspense fallback={null}>
          <AddExpenseSheet />
        </Suspense>
      )}
    </>
  );
}

const root = createRootRoute({
  component: () => (
    <ToastProvider>
      <AppProvider>
        <Shell />
      </AppProvider>
    </ToastProvider>
  ),
});

const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/', component: Overview }),
  createRoute({ getParentRoute: () => root, path: '/category/$id', component: lazyRouteComponent(() => import('../routes/CategoryDetail'), 'CategoryDetail') }),
  createRoute({ getParentRoute: () => root, path: '/scan', component: lazyRouteComponent(() => import('../routes/scan/Scan'), 'Scan') }),
  createRoute({ getParentRoute: () => root, path: '/history', component: lazyRouteComponent(() => import('../routes/History'), 'History') }),
  createRoute({ getParentRoute: () => root, path: '/receipt/$id', component: lazyRouteComponent(() => import('../routes/ReceiptDetail'), 'ReceiptDetail') }),
  createRoute({ getParentRoute: () => root, path: '/prices', component: lazyRouteComponent(() => import('../routes/Prices'), 'Prices') }),
  createRoute({ getParentRoute: () => root, path: '/product/$key', component: lazyRouteComponent(() => import('../routes/ProductDetail'), 'ProductDetail') }),
  createRoute({ getParentRoute: () => root, path: '/settings', component: lazyRouteComponent(() => import('../routes/Settings'), 'Settings') }),
  createRoute({ getParentRoute: () => root, path: '/debug', component: lazyRouteComponent(() => import('../routes/Debug'), 'Debug') }),
  createRoute({
    getParentRoute: () => root,
    path: '/test',
    component: () => (
      <Suspense fallback={null}>
        <ReadingTest />
      </Suspense>
    ),
  }),
]);

export const router = createRouter({ routeTree, history: createHashHistory(), scrollRestoration: true });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
