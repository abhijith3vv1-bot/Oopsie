import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-20 md:bottom-5 left-4 z-40 inline-flex items-center gap-2 rounded-2xl bg-[#24212B] dark:bg-[#EAE4FF] text-white dark:text-[#24212B] px-3.5 py-2 text-xs font-medium shadow-lg"
    >
      <WifiOff className="w-3.5 h-3.5 text-[#EAE4FF] dark:text-[#7657D5]" />
      <span>You&apos;re offline — saved reminders &amp; alarms still work</span>
    </div>
  );
}
