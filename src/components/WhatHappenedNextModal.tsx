import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Archive,
  CalendarClock,
  CheckCircle2,
  Clock,
  MessageSquarePlus,
  RotateCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { ReminderItem, UserProfile } from '../types/reminder';
import {
  adjustOutOfQuietHours,
  formatDueLabel,
  formatTimelineTimestamp,
  tomorrowMorningIso,
} from '../services/time';
import { AssistantOrb } from './AssistantOrb';

interface WhatHappenedNextModalProps {
  item: ReminderItem;
  userProfile: UserProfile;
  onUpdateItem: (updated: ReminderItem, closedJustNow?: boolean) => void;
  onOpenFullTimeline: (item: ReminderItem) => void;
  onClose: () => void;
}

type FollowUpOption =
  | 'done'
  | 'waiting'
  | 'new_conversation'
  | 'follow_up_again'
  | 'not_required'
  | null;

const CELEBRATION_DOTS = [
  { x: -110, y: -70, color: '#7657D5' },
  { x: 115, y: -65, color: '#16A34A' },
  { x: -135, y: 10, color: '#F59E0B' },
  { x: 135, y: 14, color: '#7657D5' },
  { x: -80, y: 80, color: '#16A34A' },
  { x: 85, y: 78, color: '#EAE4FF' },
];

function toLocalDateTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nextMondayMorningIso(wakeTime: string): string {
  const base = new Date(tomorrowMorningIso(wakeTime));
  const day = base.getDay();
  const daysUntilMon = (1 - day + 7) % 7 || 7;
  base.setDate(base.getDate() + daysUntilMon);
  return base.toISOString();
}

export function WhatHappenedNextModal({
  item,
  userProfile,
  onUpdateItem,
  onOpenFullTimeline,
  onClose,
}: WhatHappenedNextModalProps) {
  const [selected, setSelected] = useState<FollowUpOption>(null);
  const [outcomeNote, setOutcomeNote] = useState('');
  const [celebrating, setCelebrating] = useState(false);
  const [completedItemSnapshot, setCompletedItemSnapshot] = useState<ReminderItem | null>(null);

  const [newConversationNote, setNewConversationNote] = useState('');
  const [waitingNote, setWaitingNote] = useState('');
  const [schedulePreset, setSchedulePreset] = useState<'tomorrow' | 'two_days' | 'next_monday' | 'custom'>('tomorrow');
  const [customDateTime, setCustomDateTime] = useState(() => {
    const d = new Date(Date.now() + 2 * 86400000);
    d.setHours(9, 30, 0, 0);
    return toLocalDateTimeInput(d);
  });
  const [recurringDays, setRecurringDays] = useState<string>(
    item.followUpRule.intervalDays ? String(item.followUpRule.intervalDays) : ''
  );

  const originalEntry = useMemo(
    () => item.timeline.find((t) => t.type === 'created') || item.timeline[0] || null,
    [item.timeline]
  );

  const previousUpdate = useMemo(() => {
    const rev = [...item.timeline].reverse();
    return (
      rev.find(
        (t) => t.id !== originalEntry?.id && (t.type === 'user_update' || t.type === 'ai_summary' || t.type === 'rescheduled')
      ) || null
    );
  }, [item.timeline, originalEntry?.id]);

  const resolveSelectedDueIso = (): { iso: string; label: string } => {
    if (schedulePreset === 'tomorrow') {
      return { iso: tomorrowMorningIso(userProfile.wakeTime), label: 'Tomorrow morning' };
    }
    if (schedulePreset === 'two_days') {
      const d = new Date(tomorrowMorningIso(userProfile.wakeTime));
      d.setDate(d.getDate() + 1);
      return { iso: d.toISOString(), label: 'In 2 days' };
    }
    if (schedulePreset === 'next_monday') {
      return { iso: nextMondayMorningIso(userProfile.wakeTime), label: 'Next Monday' };
    }
    const parsed = customDateTime ? new Date(customDateTime) : new Date(Date.now() + 86400000);
    const iso = Number.isNaN(parsed.getTime())
      ? tomorrowMorningIso(userProfile.wakeTime)
      : parsed.toISOString();
    return { iso, label: formatDueLabel(iso) };
  };

  const handleConfirmCompleted = () => {
    const nowIso = new Date().toISOString();
    const trimmedOutcome = outcomeNote.trim();
    const closedItem: ReminderItem = {
      ...item,
      status: 'closed',
      closedAt: nowIso,
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        ...(trimmedOutcome
          ? [
              {
                id: crypto.randomUUID(),
                type: 'user_update' as const,
                text: trimmedOutcome,
                timestamp: nowIso,
              },
            ]
          : []),
        {
          id: crypto.randomUUID(),
          type: 'closed' as const,
          text: trimmedOutcome
            ? `Completed — Outcome: ${trimmedOutcome}`
            : 'Completed — Marked done.',
          timestamp: nowIso,
        },
      ],
    };

    onUpdateItem(closedItem, true);
    setCompletedItemSnapshot(closedItem);
    setCelebrating(true);
  };

  const handleSaveOutcomeAfterCelebration = () => {
    const trimmed = outcomeNote.trim();
    if (trimmed && completedItemSnapshot) {
      const nowIso = new Date().toISOString();
      const updatedWithOutcome: ReminderItem = {
        ...completedItemSnapshot,
        lastActivityAt: nowIso,
        timeline: [
          ...completedItemSnapshot.timeline,
          {
            id: crypto.randomUUID(),
            type: 'ai_summary',
            text: `Recorded outcome: ${trimmed}`,
            timestamp: nowIso,
          },
        ],
      };
      onUpdateItem(updatedWithOutcome, false);
    }
    onClose();
  };

  const handleConfirmWaiting = () => {
    const nowIso = new Date().toISOString();
    const { iso, label } = resolveSelectedDueIso();
    const safeIso = adjustOutOfQuietHours(iso, userProfile);
    const note = waitingNote.trim();

    const updated: ReminderItem = {
      ...item,
      status: 'waiting',
      dueAt: safeIso,
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        ...(note
          ? [
              {
                id: crypto.randomUUID(),
                type: 'user_update' as const,
                text: note,
                timestamp: nowIso,
              },
            ]
          : []),
        {
          id: crypto.randomUUID(),
          type: 'rescheduled' as const,
          text: `Still waiting for a response — checking again ${label.toLowerCase()}.`,
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, false);
    onClose();
  };

  const handleConfirmNewConversation = () => {
    const trimmed = newConversationNote.trim();
    if (!trimmed) return;
    const nowIso = new Date().toISOString();
    const { iso, label } = resolveSelectedDueIso();
    const safeIso = adjustOutOfQuietHours(iso, userProfile);

    const updated: ReminderItem = {
      ...item,
      status: item.person ? 'waiting' : 'needs_action',
      dueAt: safeIso,
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        {
          id: crypto.randomUUID(),
          type: 'user_update',
          text: trimmed,
          timestamp: nowIso,
        },
        {
          id: crypto.randomUUID(),
          type: 'rescheduled',
          text: `Next follow-up scheduled (${label}).`,
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, false);
    onClose();
  };

  const handleConfirmFollowUpAgain = () => {
    const nowIso = new Date().toISOString();
    const { iso, label } = resolveSelectedDueIso();
    const safeIso = adjustOutOfQuietHours(iso, userProfile);
    const daysNum = Number(recurringDays);
    const hasInterval = !Number.isNaN(daysNum) && daysNum > 0;

    const updated: ReminderItem = {
      ...item,
      status: item.person ? 'waiting' : 'needs_action',
      dueAt: safeIso,
      lastActivityAt: nowIso,
      followUpRule: {
        enabled: hasInterval || item.followUpRule.enabled,
        intervalDays: hasInterval ? daysNum : item.followUpRule.intervalDays,
        description: hasInterval
          ? `Check every ${daysNum} day${daysNum === 1 ? '' : 's'} until resolved`
          : item.followUpRule.description,
      },
      timeline: [
        ...item.timeline,
        {
          id: crypto.randomUUID(),
          type: 'rescheduled',
          text: `Scheduled next follow-up (${label})${hasInterval ? ` · repeats every ${daysNum}d` : ''}.`,
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, false);
    onClose();
  };

  const handleConfirmNotRequired = () => {
    const nowIso = new Date().toISOString();
    const updated: ReminderItem = {
      ...item,
      status: 'closed',
      closedAt: nowIso,
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        {
          id: crypto.randomUUID(),
          type: 'closed',
          text: 'Closed — no longer required (history preserved).',
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#24212B]/60 backdrop-blur-sm sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="what-happened-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.97 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
      >
        {/* Top bar */}
        <div className="px-5 sm:px-6 py-4 border-b border-[#EFEBF7] dark:border-[#2C2740] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <AssistantOrb mood={celebrating ? 'happy' : 'idle'} size="sm" />
            <div className="min-w-0">
              <h2
                id="what-happened-title"
                className="text-lg font-bold font-display text-[#24212B] dark:text-[#F5F3FA] truncate"
              >
                {celebrating ? 'Great job!' : 'Hey! What happened next?'}
              </h2>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] truncate">
                {item.person ? `Conversation with ${item.person}` : item.category} ·{' '}
                {formatDueLabel(item.dueAt)}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close follow-up check-in"
            className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#2B2444] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          {celebrating ? (
            <div className="relative py-4 text-center space-y-5">
              {/* Celebration confetti dots */}
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
                {CELEBRATION_DOTS.map((dot, idx) => (
                  <motion.span
                    key={idx}
                    initial={{ opacity: 0, scale: 0.3, x: 0, y: 0 }}
                    animate={{
                      opacity: [0, 1, 0],
                      scale: [0.4, 1.2, 0.6],
                      x: dot.x,
                      y: dot.y,
                    }}
                    transition={{ duration: 1.1, delay: idx * 0.05, ease: 'easeOut' }}
                    style={{ backgroundColor: dot.color }}
                    className="absolute w-3 h-3 rounded-full"
                  />
                ))}
              </div>

              <div className="flex flex-col items-center gap-3">
                <AssistantOrb mood="happy" size="lg" />
                <h3 className="text-xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Great job! One less thing to worry about.
                </h3>
                <p className="text-sm text-[#666173] dark:text-[#A7A2B8] max-w-sm">
                  &quot;{item.title}&quot; is marked completed and safely stored in your timeline.
                </p>
              </div>

              <div className="text-left space-y-2 pt-2">
                <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                  Want to record the final outcome? (Optional)
                </label>
                <input
                  type="text"
                  value={outcomeNote}
                  onChange={(e) => setOutcomeNote(e.target.value)}
                  placeholder="e.g., Approved 8% discount and signed PO"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA]"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-sm font-medium text-[#666173] dark:text-[#A7A2B8]"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={handleSaveOutcomeAfterCelebration}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-sm font-semibold"
                >
                  {outcomeNote.trim() ? 'Save outcome & finish' : 'Done'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* Original Conversation & Previous Update Context */}
              <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                    {item.title}
                  </h3>
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onOpenFullTimeline(item);
                    }}
                    className="text-xs font-medium text-[#7657D5] dark:text-[#C5B4FF] hover:underline whitespace-nowrap shrink-0"
                  >
                    Full timeline
                  </button>
                </div>

                {originalEntry && (
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                    <span className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                      Started ({formatTimelineTimestamp(originalEntry.timestamp)}):
                    </span>{' '}
                    {originalEntry.text}
                  </p>
                )}

                {previousUpdate && (
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed pt-1 border-t border-[#EFEBF7] dark:border-[#2C2740]">
                    <span className="font-semibold text-[#7657D5] dark:text-[#C5B4FF]">
                      Previous update ({formatTimelineTimestamp(previousUpdate.timestamp)}):
                    </span>{' '}
                    {previousUpdate.text}
                  </p>
                )}
              </div>

              {/* 5 Interactive Options */}
              <div className="space-y-2">
                {[
                  {
                    id: 'done' as const,
                    label: "It's done!",
                    sub: 'Mark completed and optionally record the outcome',
                    icon: CheckCircle2,
                    tone: 'text-emerald-600 dark:text-emerald-400',
                  },
                  {
                    id: 'waiting' as const,
                    label: 'Still waiting for a response',
                    sub: 'Pick when Oopsie should check back with you',
                    icon: Clock,
                    tone: 'text-amber-600 dark:text-amber-400',
                  },
                  {
                    id: 'new_conversation' as const,
                    label: 'We discussed something new',
                    sub: 'Log the latest update, keep history, and set the next step',
                    icon: MessageSquarePlus,
                    tone: 'text-[#7657D5] dark:text-[#C5B4FF]',
                  },
                  {
                    id: 'follow_up_again' as const,
                    label: 'Need to follow up again',
                    sub: 'Schedule another follow-up or recurring check-in',
                    icon: RotateCw,
                    tone: 'text-[#7657D5] dark:text-[#C5B4FF]',
                  },
                  {
                    id: 'not_required' as const,
                    label: 'No longer required',
                    sub: 'Close this reminder cleanly while retaining all history',
                    icon: Archive,
                    tone: 'text-[#666173] dark:text-[#A7A2B8]',
                  },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const isActive = selected === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        if (opt.id === 'done') {
                          handleConfirmCompleted();
                          return;
                        }
                        setSelected(opt.id);
                      }}
                      className={`w-full text-left flex items-center gap-3.5 px-4 py-3 rounded-2xl border transition-colors ${
                        isActive
                          ? 'border-[#7657D5] bg-[#EAE4FF]/55 dark:bg-[#2B2444]'
                          : 'border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:border-[#7657D5]/60 hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]'
                      }`}
                    >
                      <span className={`w-9 h-9 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] flex items-center justify-center shrink-0 ${opt.tone}`}>
                        <Icon className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                          {opt.label}
                        </p>
                        <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                          {opt.sub}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Next Step Panel */}
              <AnimatePresence mode="wait">
                {(selected === 'waiting' ||
                  selected === 'new_conversation' ||
                  selected === 'follow_up_again') && (
                  <motion.div
                    key={selected}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-2xl bg-[#EAE4FF]/40 dark:bg-[#2B2444]/60 border border-[#DDD3FA] dark:border-[#3D3363] p-4 space-y-3.5"
                  >
                    {selected === 'new_conversation' && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                          What happened in the latest conversation?
                        </label>
                        <textarea
                          rows={2}
                          autoFocus
                          value={newConversationNote}
                          onChange={(e) => setNewConversationNote(e.target.value)}
                          placeholder="e.g., Vendor requested one more day to confirm shipping rates."
                          className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] resize-none"
                        />
                      </div>
                    )}

                    {selected === 'waiting' && (
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                          Should I check back with you tomorrow, or another day?
                        </label>
                        <input
                          type="text"
                          value={waitingNote}
                          onChange={(e) => setWaitingNote(e.target.value)}
                          placeholder="Optional quick note (e.g., Sent polite ping on Slack)"
                          className="w-full h-10 px-3 rounded-xl bg-white dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-xs text-[#24212B] dark:text-[#F5F3FA]"
                        />
                      </div>
                    )}

                    {selected === 'follow_up_again' && (
                      <div className="flex items-center gap-2 text-xs text-[#24212B] dark:text-[#F5F3FA]">
                        <Sparkles className="w-3.5 h-3.5 text-[#7657D5] shrink-0" />
                        <span>Repeat every</span>
                        <input
                          type="number"
                          min="0"
                          max="60"
                          value={recurringDays}
                          onChange={(e) => setRecurringDays(e.target.value)}
                          placeholder="2"
                          className="w-14 h-8 px-2 rounded-lg bg-white dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-center"
                        />
                        <span>days until resolved (optional)</span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                        When should Oopsie follow up again?
                      </p>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { id: 'tomorrow' as const, label: 'Tomorrow' },
                          { id: 'two_days' as const, label: 'In 2 days' },
                          { id: 'next_monday' as const, label: 'Next Monday' },
                          { id: 'custom' as const, label: 'Pick date' },
                        ].map((btn) => (
                          <button
                            key={btn.id}
                            type="button"
                            onClick={() => setSchedulePreset(btn.id)}
                            className={`min-h-[38px] px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-colors ${
                              schedulePreset === btn.id
                                ? 'bg-[#7657D5] border-[#7657D5] text-white'
                                : 'bg-white dark:bg-[#1A1726] border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA]'
                            }`}
                          >
                            {btn.label}
                          </button>
                        ))}
                      </div>

                      {schedulePreset === 'custom' && (
                        <div className="flex items-center gap-2 pt-1">
                          <CalendarClock className="w-4 h-4 text-[#7657D5] shrink-0" />
                          <input
                            type="datetime-local"
                            value={customDateTime}
                            onChange={(e) => setCustomDateTime(e.target.value)}
                            className="flex-1 h-10 px-3 rounded-xl bg-white dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-xs text-[#24212B] dark:text-[#F5F3FA]"
                          />
                        </div>
                      )}
                    </div>

                    <div className="flex justify-end pt-1">
                      <button
                        type="button"
                        disabled={selected === 'new_conversation' && !newConversationNote.trim()}
                        onClick={
                          selected === 'waiting'
                            ? handleConfirmWaiting
                            : selected === 'new_conversation'
                              ? handleConfirmNewConversation
                              : handleConfirmFollowUpAgain
                        }
                        className="min-h-[42px] px-5 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] disabled:opacity-40 text-white text-xs sm:text-sm font-semibold transition-colors"
                      >
                        {selected === 'new_conversation'
                          ? 'Save update & schedule'
                          : 'Schedule check-in'}
                      </button>
                    </div>
                  </motion.div>
                )}

                {selected === 'not_required' && (
                  <motion.div
                    key="not_required"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 flex items-center justify-between gap-3"
                  >
                    <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                      Oopsie will close this reminder and preserve its conversation timeline.
                    </p>
                    <button
                      type="button"
                      onClick={handleConfirmNotRequired}
                      className="min-h-[40px] px-4 py-2 rounded-xl bg-[#24212B] dark:bg-[#EAE4FF] text-white dark:text-[#24212B] text-xs font-semibold whitespace-nowrap shrink-0"
                    >
                      Close reminder
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
