import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_STORAGE_KEY = 'oopsie_pwa_install_dismissed_v1';

interface PWAContextValue {
  needRefresh: boolean;
  offlineReady: boolean;
  applyUpdate: () => Promise<void>;
  dismissUpdate: () => void;
  dismissOfflineReady: () => void;
  canPromptNatively: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isMobileViewport: boolean;
  promptDismissed: boolean;
  shouldShowInstallBanner: boolean;
  promptInstall: () => Promise<boolean>;
  dismissInstallPrompt: () => void;
}

const PWAContext = createContext<PWAContextValue | null>(null);

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const classicIOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOS = ua.includes('Mac') && navigator.maxTouchPoints > 1;
  return (classicIOS || iPadOS) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function readDismissed(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DISMISS_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function PWAProvider({ children }: { children: ReactNode }) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState<boolean>(readDismissed);
  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  const isIOS = detectIOS();

  useEffect(() => {
    const updateSW = registerSW({
      immediate: false,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
      onRegisteredSW(_swUrl, registration) {
        if (!registration) return;
        const interval = window.setInterval(() => {
          if (navigator.onLine) {
            void registration.update().catch(() => {});
          }
        }, 60 * 60 * 1000);
        return () => window.clearInterval(interval);
      },
    });
    updateSWRef.current = updateSW;
  }, []);

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const checkInstalled = () => {
      const iosStandalone =
        (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standaloneQuery.matches || iosStandalone);
    };
    checkInstalled();

    const onResize = () => setIsMobileViewport(window.innerWidth < 768);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
      try {
        localStorage.removeItem(DISMISS_STORAGE_KEY);
      } catch {
        // Ignore storage restrictions
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('resize', onResize, { passive: true });
    standaloneQuery.addEventListener?.('change', checkInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('resize', onResize);
      standaloneQuery.removeEventListener?.('change', checkInstalled);
    };
  }, []);

  const applyUpdate = useCallback(async () => {
    setNeedRefresh(false);
    if (updateSWRef.current) {
      await updateSWRef.current(true);
    } else {
      window.location.reload();
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setNeedRefresh(false);
  }, []);

  const dismissOfflineReady = useCallback(() => {
    setOfflineReady(false);
  }, []);

  const dismissInstallPrompt = useCallback(() => {
    setPromptDismissed(true);
    try {
      localStorage.setItem(DISMISS_STORAGE_KEY, '1');
    } catch {
      // Ignore storage restrictions
    }
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setIsInstalled(true);
    } else {
      dismissInstallPrompt();
    }
    return outcome === 'accepted';
  }, [deferredPrompt, dismissInstallPrompt]);

  const shouldShowInstallBanner =
    !isInstalled && !promptDismissed && (Boolean(deferredPrompt) || isIOS);

  return (
    <PWAContext.Provider
      value={{
        needRefresh,
        offlineReady,
        applyUpdate,
        dismissUpdate,
        dismissOfflineReady,
        canPromptNatively: Boolean(deferredPrompt),
        isInstalled,
        isIOS,
        isMobileViewport,
        promptDismissed,
        shouldShowInstallBanner,
        promptInstall,
        dismissInstallPrompt,
      }}
    >
      {children}
    </PWAContext.Provider>
  );
}

export function usePWA(): PWAContextValue {
  const ctx = useContext(PWAContext);
  if (!ctx) {
    throw new Error('usePWA must be used inside PWAProvider');
  }
  return ctx;
}
