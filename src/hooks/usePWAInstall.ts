import { usePWA } from '../contexts/PWAContext';

export function usePWAInstall() {
  const {
    canPromptNatively,
    isInstalled,
    isIOS,
    promptDismissed,
    shouldShowInstallBanner,
    promptInstall,
    dismissInstallPrompt,
  } = usePWA();

  return {
    canPromptNatively,
    isInstalled,
    isIOS,
    promptDismissed,
    shouldShowInstallBanner,
    promptInstall,
    dismissInstallPrompt,
  };
}
