import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export function PWAInstallBanner() {
  const {
    canPromptNatively,
    isInstalled,
    isIOS,
    shouldShowInstallBanner,
    promptInstall,
    dismissInstallPrompt,
  } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled || !shouldShowInstallBanner) return null;

  const handleInstallClick = async () => {
    if (canPromptNatively) {
      await promptInstall();
      return;
    }
    setShowIOSGuide((v) => !v);
  };

  return (
    <div className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 sm:px-4 shadow-xs space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#B9A7F5] flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
              Install Oopsie
            </p>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-snug">
              {isIOS
                ? 'Add Oopsie to your iPhone Home Screen for full-screen standalone access.'
                : 'Open Oopsie directly from your home screen or desktop app launcher.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <button
            type="button"
            onClick={handleInstallClick}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold transition-colors whitespace-nowrap"
          >
            {isIOS && !canPromptNatively ? (
              <>
                <Share className="w-4 h-4 shrink-0" />
                <span>{showIOSGuide ? 'Hide steps' : 'How to install'}</span>
              </>
            ) : (
              <>
                <Download className="w-4 h-4 shrink-0" />
                <span>Install Oopsie</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={dismissInstallPrompt}
            aria-label="Dismiss install Oopsie prompt"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-[#666173] dark:text-[#A7A2B8] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showIOSGuide && isIOS && (
        <div className="rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3 text-xs text-[#666173] dark:text-[#A7A2B8] space-y-1.5 leading-relaxed">
          <p className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
            Safari on iPhone &amp; iPad:
          </p>
          <p>
            1. Tap the <Share className="inline w-3.5 h-3.5 text-[#7657D5]" /> <strong>Share</strong> button in Safari&apos;s toolbar.
          </p>
          <p>
            2. Scroll and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
          </p>
        </div>
      )}
    </div>
  );
}
