import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);

  const isIOS =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(window as unknown as { MSStream?: unknown }).MSStream;

  useEffect(() => {
    const standaloneQuery = window.matchMedia('(display-mode: standalone)');
    const checkInstalled = () => {
      const iosStandalone = (window.navigator as unknown as { standalone?: boolean }).standalone === true;
      setIsInstalled(standaloneQuery.matches || iosStandalone);
    };
    checkInstalled();

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    standaloneQuery.addEventListener?.('change', checkInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      standaloneQuery.removeEventListener?.('change', checkInstalled);
    };
  }, []);

  const promptInstall = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') setIsInstalled(true);
    return outcome === 'accepted';
  };

  return {
    canPromptNatively: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    promptInstall,
  };
}
