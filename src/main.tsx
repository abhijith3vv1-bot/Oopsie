import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { FirebaseProvider } from './contexts/FirebaseContext.tsx';
import { PWAProvider } from './contexts/PWAContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <PWAProvider>
      <FirebaseProvider>
        <App />
      </FirebaseProvider>
    </PWAProvider>
  </ErrorBoundary>
);
