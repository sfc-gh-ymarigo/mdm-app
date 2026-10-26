import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './i18n';
import { ToastProvider } from './components/common/Toast';
import { ConfirmProvider } from './components/common/Confirm';
import { BreadcrumbProvider } from './components/common/Breadcrumbs';
import App from './App';
import { AppThemeProvider } from './theme/ThemeContext';
import { UserProvider, getCurrentUserEmail } from './context/UserContext';
import { BrandProvider } from './config/BrandContext';

// Every /api call must carry the acting user: the API and Postgres RLS scope data by it.
const nativeFetch = window.fetch.bind(window);
window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith('/api') && !url.startsWith(`${window.location.origin}/api`)) return nativeFetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has('x-mdm-user')) headers.set('x-mdm-user', getCurrentUserEmail());
  return nativeFetch(input, { ...init, headers });
};

// Data router: needed for useBlocker (unsaved-changes guard). App keeps its own <Routes>.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrandProvider>
      <AppThemeProvider>
        <UserProvider>
          <ToastProvider>
            <ConfirmProvider>
              <BreadcrumbProvider>
                <RouterProvider router={router} />
              </BreadcrumbProvider>
            </ConfirmProvider>
          </ToastProvider>
        </UserProvider>
      </AppThemeProvider>
    </BrandProvider>
  </React.StrictMode>,
);
