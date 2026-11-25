import { useEffect, useRef, useState } from 'react';
import { Wifi, WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [justRestored, setJustRestored] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    let restoreTimer: number | undefined;

    const onOnline = () => {
      setIsOnline(true);
      if (wasOfflineRef.current) {
        setJustRestored(true);
        window.clearTimeout(restoreTimer);
        restoreTimer = window.setTimeout(() => setJustRestored(false), 3800);
      }
      wasOfflineRef.current = false;
    };

    const onOffline = () => {
      wasOfflineRef.current = true;
      setJustRestored(false);
      setIsOnline(false);
    };

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      wasOfflineRef.current = true;
    }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline && !justRestored) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] md:bottom-5 left-4 right-4 sm:right-auto sm:max-w-md z-40 inline-flex items-center gap-2.5 rounded-2xl px-3.5 py-2.5 text-xs font-medium shadow-lg border ${
        isOnline
          ? 'bg-emerald-600 text-white border-emerald-500'
          : 'bg-[#24212B] dark:bg-[#EAE4FF] text-white dark:text-[#24212B] border-[#3A3352] dark:border-[#D5CFE6]'
      }`}
    >
      {isOnline ? (
        <>
          <Wifi className="w-4 h-4 shrink-0" />
          <span>Back online — syncing saved changes now</span>
        </>
      ) : (
        <>
          <WifiOff className="w-4 h-4 shrink-0 text-[#EAE4FF] dark:text-[#7657D5]" />
          <span>You&apos;re offline — local reminders stay available and will sync when reconnected</span>
        </>
      )}
    </div>
  );
}
