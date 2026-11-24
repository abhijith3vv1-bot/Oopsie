import { useState } from 'react';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
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
            ? 'min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap shrink-0 transition-colors'
            : 'min-h-[40px] inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#EAE4FF]/70 dark:bg-[#2B2444] hover:bg-[#EAE4FF] dark:hover:bg-[#352C54] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap shrink-0 transition-colors'
        }
      >
        <Download className="w-3.5 h-3.5 text-[#7657D5] dark:text-[#B9A7F5]" />
        <span>Install Oopsie app</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-[#24212B]/55 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="install-guide-title"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="install-guide-title" className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Add Oopsie to your home screen
                </h3>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8] mt-0.5">
                  Launch Oopsie like a native app on phone or desktop.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install instructions"
                className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-[#666173] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                <li>
                  1. Tap the <Share className="inline w-3.5 h-3.5 text-[#7657D5]" /> <strong>Share</strong> button in Safari.
                </li>
                <li>
                  2. Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
                <li>
                  3. Tap <strong>Add</strong>—Oopsie will sit right alongside your apps.
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                <li>1. Open your browser menu or look for the install icon in the address bar.</li>
                <li>
                  2. Choose <strong>Install Oopsie</strong> or <strong>Add to Home screen</strong>.
                </li>
                <li>3. Open Oopsie anytime as its own standalone window!</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[42px] rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
