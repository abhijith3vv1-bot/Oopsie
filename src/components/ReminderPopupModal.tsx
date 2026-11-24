import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { BellRing, CalendarClock, Clock, MessageSquarePlus, Sparkles, X } from 'lucide-react';
import type { ReminderItem, UserProfile } from '../types/reminder';
import { checkRepeatedSnooze } from '../services/api';
import { acquireWakeLock, releaseWakeLock, unlockAudio } from '../services/alarm';
import { formatDueLabel, tomorrowMorningIso } from '../services/time';
import { AssistantOrb } from './AssistantOrb';

interface ReminderPopupModalProps {
  item: ReminderItem;
  userProfile: UserProfile;
  ringCount?: number;
  onDone: (item: ReminderItem) => void;
  onSnooze: (item: ReminderItem, newDueIso: string, label: string) => void;
  onNeedsFollowUp: (item: ReminderItem) => void;
  onDropItem: (item: ReminderItem) => void;
  onDismiss: () => void;
}

const SPARKLES = [
  { x: -135, y: -115, color: '#EAE4FF', size: 12, delay: 0.05 },
  { x: 140, y: -110, color: '#7657D5', size: 10, delay: 0.1 },
  { x: -175, y: -25, color: '#34D399', size: 9, delay: 0.14 },
  { x: 175, y: -18, color: '#B9A7F5', size: 11, delay: 0.08 },
  { x: -120, y: 115, color: '#60A5FA', size: 10, delay: 0.16 },
  { x: 130, y: 120, color: '#7657D5', size: 12, delay: 0.12 },
  { x: -45, y: -145, color: '#F59E0B', size: 9, delay: 0.07 },
  { x: 55, y: -140, color: '#34D399', size: 10, delay: 0.11 },
];

export function ReminderPopupModal({
  item,
  userProfile,
  ringCount = 1,
  onDone,
  onSnooze,
  onNeedsFollowUp,
  onDropItem,
  onDismiss,
}: ReminderPopupModalProps) {
  const [showCustom, setShowCustom] = useState(false);
  const [customDateTime, setCustomDateTime] = useState(() => {
    const d = new Date(Date.now() + 2 * 3600000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [snoozeReflection, setSnoozeReflection] = useState<string | null>(null);

  useEffect(() => {
    void acquireWakeLock();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void acquireWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    if (item.snoozeCount >= 3) {
      checkRepeatedSnooze(item, userProfile)
        .then((res) => setSnoozeReflection(res.message))
        .catch(() => {
          setSnoozeReflection(
            `You've pushed this back ${item.snoozeCount} times—no guilt at all. Is it still something you want on your plate, or should we move it to next week?`
          );
        });
    }
  }, [item, userProfile]);

  const snoozeMinutes = (mins: number, label: string) => {
    void unlockAudio();
    const nextIso = new Date(Date.now() + mins * 60000).toISOString();
    onSnooze(item, nextIso, label);
  };

  const handleNextWeek = () => {
    void unlockAudio();
    const d = new Date(tomorrowMorningIso(userProfile.wakeTime));
    d.setDate(d.getDate() + 6);
    onSnooze(item, d.toISOString(), 'Next week');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#24212B]/65 backdrop-blur-md p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reminder-popup-title"
    >
      <div className="relative w-full max-w-md my-auto flex items-center justify-center">
        {/* Confetti-style sparkles on entrance */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible" aria-hidden="true">
          {SPARKLES.map((sp, idx) => (
            <motion.span
              key={idx}
              initial={{ opacity: 0, scale: 0.2, x: 0, y: 0, rotate: 0 }}
              animate={{
                opacity: [0, 1, 1, 0],
                scale: [0.4, 1.15, 1, 0.7],
                x: sp.x,
                y: sp.y,
                rotate: idx % 2 === 0 ? 140 : -140,
              }}
              transition={{
                duration: 1.5,
                delay: sp.delay,
                repeat: Infinity,
                repeatDelay: 2.2,
                ease: 'easeOut',
              }}
              style={{
                width: sp.size,
                height: sp.size,
                backgroundColor: sp.color,
              }}
              className="absolute rounded-sm shadow-sm"
            />
          ))}
        </div>

        {/* Full-screen bouncing alert card */}
        <motion.div
          initial={{ opacity: 0, y: 36, scale: 0.86 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 24, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 420, damping: 21 }}
          className="relative w-full rounded-3xl bg-white dark:bg-[#1A1726] border-2 border-[#7657D5]/50 dark:border-[#493E70] shadow-2xl p-6 sm:p-7 space-y-5 text-center"
        >
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Close alarm popup"
            className="absolute right-4 top-4 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Animated bouncing surprised Oopsie mascot */}
          <div className="flex flex-col items-center gap-3 pt-1">
            <motion.div
              animate={{ y: [0, -10, 0], rotate: [-3, 3, -3] }}
              transition={{ duration: 1.15, repeat: Infinity, ease: 'easeInOut' }}
            >
              <AssistantOrb mood="oops" size="lg" />
            </motion.div>

            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7657D5] dark:text-[#B9A7F5]">
              <BellRing className="w-3.5 h-3.5" />
              <span>
                Follow-up triggered · {formatDueLabel(item.dueAt)}
                {ringCount > 1 ? ` · Chime ${ringCount}/5` : ''}
              </span>
            </div>

            <h2
              id="reminder-popup-title"
              className="text-xl sm:text-2xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA] leading-snug text-balance px-2"
            >
              {item.title}
            </h2>

            {(item.person || item.category) && (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                {item.person ? `With ${item.person} · ` : ''}
                {item.category}
                {item.followUpRule.enabled ? ' · Follow-up active' : ''}
              </p>
            )}
          </div>

          {snoozeReflection && (
            <div className="rounded-2xl bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-900/60 p-3.5 text-left text-sm text-amber-950 dark:text-amber-100 space-y-2.5">
              <p className="leading-relaxed">{snoozeReflection}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleNextWeek}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#12101A] border border-amber-200 dark:border-amber-800 text-xs font-medium hover:bg-amber-100/50 dark:hover:bg-[#241F35]"
                >
                  Push to next week
                </button>
                <button
                  type="button"
                  onClick={() => onDropItem(item)}
                  className="min-h-[36px] px-3 py-1.5 rounded-xl text-xs font-medium text-amber-800 dark:text-amber-300 hover:underline"
                >
                  No longer required
                </button>
              </div>
            </div>
          )}

          {/* Big Primary Buttons: What happened?, Snooze, Reschedule */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <button
              type="button"
              onClick={() => {
                void unlockAudio();
                onDone(item);
              }}
              className="min-h-[48px] inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-2xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-semibold shadow-sm transition-colors whitespace-nowrap"
            >
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>What happened?</span>
            </button>

            <button
              type="button"
              onClick={() => snoozeMinutes(10, '10 min')}
              className="min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl bg-[#EAE4FF] hover:bg-[#DDD3FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] text-[#4C32A8] dark:text-[#EAE4FF] text-sm font-semibold shadow-sm transition-colors"
            >
              <Clock className="w-4 h-4" />
              <span>Snooze</span>
            </button>

            <button
              type="button"
              onClick={() => setShowCustom((v) => !v)}
              className={`min-h-[48px] inline-flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-semibold transition-colors ${
                showCustom
                  ? 'border-[#7657D5] text-[#7657D5] dark:text-[#B9A7F5] bg-[#EAE4FF]/50 dark:bg-[#2B2444]'
                  : 'border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] hover:bg-[#EAE4FF]/40 dark:hover:bg-[#241F35] text-[#24212B] dark:text-[#F5F3FA]'
              }`}
            >
              <CalendarClock className="w-4 h-4" />
              <span>Reschedule</span>
            </button>
          </div>

          {/* Quick Snooze Presets & Follow-up shortcut */}
          <div className="space-y-2.5 pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740] text-left">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                Quick snooze
              </span>
              <button
                type="button"
                onClick={() => onNeedsFollowUp(item)}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#7657D5] dark:text-[#B9A7F5] hover:underline"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Open timeline</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => snoozeMinutes(10, '10 min')}
                className="min-h-[38px] px-2 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] transition-colors"
              >
                10 min
              </button>
              <button
                type="button"
                onClick={() => snoozeMinutes(60, '1 hr')}
                className="min-h-[38px] px-2 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] transition-colors"
              >
                1 hr
              </button>
              <button
                type="button"
                onClick={() => onSnooze(item, tomorrowMorningIso(userProfile.wakeTime), 'Tomorrow')}
                className="min-h-[38px] px-2 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] transition-colors"
              >
                Tomorrow
              </button>
            </div>

            {showCustom && (
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="datetime-local"
                  value={customDateTime}
                  onChange={(e) => setCustomDateTime(e.target.value)}
                  className="flex-1 h-10 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!customDateTime) return;
                    void unlockAudio();
                    onSnooze(item, new Date(customDateTime).toISOString(), 'Rescheduled');
                  }}
                  className="min-h-[40px] px-4 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-medium whitespace-nowrap shrink-0"
                >
                  Set time
                </button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
