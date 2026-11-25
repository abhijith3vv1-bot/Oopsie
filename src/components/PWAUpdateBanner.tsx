import { RefreshCw, X } from 'lucide-react';
import { usePWA } from '../contexts/PWAContext';

export function PWAUpdateBanner() {
  const { needRefresh, applyUpdate, dismissUpdate } = usePWA();

  if (!needRefresh) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-5 right-4 left-4 sm:left-auto sm:max-w-sm z-40 rounded-2xl bg-white dark:bg-[#1A1726] border border-[#7657D5]/35 dark:border-[#9E84EE]/45 shadow-xl p-3.5 flex items-center justify-between gap-3"
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
          New Oopsie update ready
        </p>
        <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">
          Refresh whenever you&apos;re ready to load the latest version.
        </p>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => void applyUpdate()}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Update</span>
        </button>
        <button
          type="button"
          onClick={dismissUpdate}
          aria-label="Dismiss update notification"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
