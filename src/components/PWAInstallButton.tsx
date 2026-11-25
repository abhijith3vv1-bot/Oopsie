import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  fullWidth?: boolean;
  label?: string;
}

export function PWAInstallButton({
  compact = false,
  fullWidth = false,
  label = 'Install Oopsie',
}: PWAInstallButtonProps) {
  const { canPromptNatively, isInstalled, isIOS, promptInstall } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canPromptNatively) {
      await promptInstall();
      return;
    }
    setShowGuide(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={
          compact
            ? 'min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap shrink-0 transition-colors'
            : `${fullWidth ? 'w-full justify-center ' : ''}min-h-[44px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#EAE4FF]/70 dark:bg-[#2B2444] hover:bg-[#EAE4FF] dark:hover:bg-[#352C54] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap shrink-0 transition-colors`
        }
      >
        <Download className="w-4 h-4 text-[#7657D5] dark:text-[#B9A7F5] shrink-0" />
        <span>{label}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center bg-[#24212B]/55 backdrop-blur-sm p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 shadow-xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3
                  id="install-guide-title"
                  className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]"
                >
                  Install Oopsie on your device
                </h3>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8] mt-0.5">
                  Launch Oopsie in full-screen standalone mode without browser bars.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#666173] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-3 text-sm sm:text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                <li>
                  1. Open Oopsie in <strong>Safari</strong> and tap the{' '}
                  <Share className="inline w-4 h-4 text-[#7657D5]" /> <strong>Share</strong> icon in the toolbar.
                </li>
                <li>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  3. Tap <strong>Add</strong> — Oopsie opens right from your Home Screen in standalone mode.
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm sm:text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                <li>1. Open your browser menu or tap the install icon in the address bar.</li>
                <li>
                  2. Choose <strong>Install Oopsie</strong> or <strong>Add to Home screen</strong>.
                </li>
                <li>3. Open Oopsie anytime as its own standalone app.</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-semibold transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
