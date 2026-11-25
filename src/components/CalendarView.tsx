import { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import {
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  MessageSquarePlus,
  Plus,
} from 'lucide-react';
import type {
  ParsedReminderDraft,
  ReminderItem,
  UserProfile,
} from '../types/reminder';
import { isOverdue, toLocalDateKey } from '../services/time';
import { AssistantOrb } from './AssistantOrb';
import { LiveClock } from './LiveClock';
import { ReminderCard } from './ReminderCard';

interface CalendarViewProps {
  items: ReminderItem[];
  userProfile: UserProfile;
  now: Date;
  onComplete: (item: ReminderItem) => void;
  onSnoozeQuick: (item: ReminderItem) => void;
  onOpenTimeline: (item: ReminderItem) => void;
  onQuickCreateForDay: (draft: ParsedReminderDraft, rawNote: string) => void;
  onAskOopsieForDay: (dateLabel: string) => void;
  onOpenAddForDay?: (dateIso: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface CalendarCell {
  date: Date;
  dateKey: string;
  inCurrentMonth: boolean;
}

function buildMonthGrid(year: number, month: number): CalendarCell[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);

  const cells: CalendarCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({
      date: d,
      dateKey: toLocalDateKey(d),
      inCurrentMonth: d.getMonth() === month,
    });
  }
  return cells;
}

export function CalendarView({
  items,
  userProfile,
  now,
  onComplete,
  onSnoozeQuick,
  onOpenTimeline,
  onQuickCreateForDay,
  onAskOopsieForDay,
  onOpenAddForDay,
}: CalendarViewProps) {
  const todayKey = toLocalDateKey(now);

  const [viewMonth, setViewMonth] = useState<{ year: number; month: number }>(() => ({
    year: now.getFullYear(),
    month: now.getMonth(),
  }));
  const [selectedKey, setSelectedKey] = useState<string>(() => todayKey);

  // Quick-add state for selected calendar day
  const [quickTitle, setQuickTitle] = useState('');
  const [quickTime, setQuickTime] = useState('10:00');
  const [quickPerson, setQuickPerson] = useState('');

  const cells = useMemo(
    () => buildMonthGrid(viewMonth.year, viewMonth.month),
    [viewMonth.year, viewMonth.month]
  );

  // Group items by local YYYY-MM-DD key
  const itemsByDay = useMemo(() => {
    const map = new Map<string, ReminderItem[]>();
    for (const item of items) {
      const key = toLocalDateKey(item.dueAt);
      if (!key) continue;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    for (const [, list] of map) {
      list.sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    }
    return map;
  }, [items]);

  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedKey.split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }, [selectedKey]);

  const selectedItems = useMemo(
    () => itemsByDay.get(selectedKey) ?? [],
    [itemsByDay, selectedKey]
  );

  const selectedLabel = useMemo(() => {
    const base = selectedDate.toLocaleDateString([], {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
    return selectedKey === todayKey ? `${base} · Today` : base;
  }, [selectedDate, selectedKey, todayKey]);

  const monthTitle = useMemo(() => {
    return new Date(viewMonth.year, viewMonth.month, 1).toLocaleDateString([], {
      month: 'long',
      year: 'numeric',
    });
  }, [viewMonth.year, viewMonth.month]);

  const shiftMonth = (delta: number) => {
    setViewMonth((prev) => {
      const next = new Date(prev.year, prev.month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  const jumpToToday = () => {
    const current = new Date();
    setViewMonth({ year: current.getFullYear(), month: current.getMonth() });
    setSelectedKey(toLocalDateKey(current));
  };

  const handleQuickSchedule = (e: React.FormEvent) => {
    e.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;

    const [hhStr, mmStr] = quickTime.split(':');
    const hh = Number(hhStr);
    const mm = Number(mmStr);
    const scheduled = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      Number.isNaN(hh) ? 10 : hh,
      Number.isNaN(mm) ? 0 : mm,
      0,
      0
    );

    const person = quickPerson.trim() || null;
    const draft: ParsedReminderDraft = {
      title,
      person,
      project: null,
      category: person ? 'Social' : 'Personal',
      priority: 'medium',
      dueAtIso: scheduled.toISOString(),
      needsFollowUp: Boolean(person),
      initialStatus: 'needs_action',
      followUpRule: {
        enabled: false,
        intervalDays: null,
        description: null,
      },
    };

    onQuickCreateForDay(
      draft,
      `${title} on ${selectedDate.toLocaleDateString()} at ${quickTime}`
    );
    setQuickTitle('');
    setQuickPerson('');
  };

  const isViewingTodayMonth =
    viewMonth.year === now.getFullYear() &&
    viewMonth.month === now.getMonth() &&
    selectedKey === todayKey;

  const selectedDayIsoForModal = useMemo(() => {
    const d = new Date(
      selectedDate.getFullYear(),
      selectedDate.getMonth(),
      selectedDate.getDate(),
      10,
      0,
      0,
      0
    );
    return d.toISOString();
  }, [selectedDate]);

  return (
    <div className="space-y-6">
      {/* Live Real-Time Clock & Date Header */}
      <section className="rounded-3xl bg-gradient-to-br from-white via-[#FAF9FC] to-[#EAE4FF]/55 dark:from-[#1A1726] dark:via-[#1A1726] dark:to-[#241F35] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <AssistantOrb mood={selectedItems.some((i) => isOverdue(i, now)) ? 'oops' : 'idle'} size="sm" />
          <div className="space-y-1">
            <p className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
              Schedule &amp; live clock · {userProfile.timezone}
            </p>
            <LiveClock />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          {!isViewingTodayMonth && (
            <button
              type="button"
              onClick={jumpToToday}
              className="min-h-[44px] sm:min-h-[40px] px-4 py-2 rounded-xl bg-[#EAE4FF] hover:bg-[#DDD3FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              Jump to Today
            </button>
          )}
          {onOpenAddForDay && (
            <button
              type="button"
              onClick={() => onOpenAddForDay(selectedDayIsoForModal)}
              className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add on day</span>
            </button>
          )}
        </div>
      </section>

      {/* Main Calendar Grid + Selected Day Agenda */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Monthly Calendar Grid */}
        <section
          aria-label="Monthly calendar"
          className="lg:col-span-7 rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 sm:p-6 space-y-4"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-lg sm:text-xl font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
              {monthTitle}
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] text-[#24212B] dark:text-[#F5F3FA] transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] text-[#24212B] dark:text-[#F5F3FA] transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Weekday headings */}
          <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase tracking-wide text-[#8E899E] dark:text-[#7F7994]">
            {WEEKDAYS.map((day) => (
              <div key={day} className="py-1.5">
                {day}
              </div>
            ))}
          </div>

          {/* 6x7 day cells */}
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {cells.map((cell) => {
              const dayItems = itemsByDay.get(cell.dateKey) ?? [];
              const activeDayItems = dayItems.filter((i) => i.status !== 'closed');
              const hasOverdue = activeDayItems.some((i) => isOverdue(i, now));
              const hasWaiting = activeDayItems.some((i) => i.status === 'waiting');
              const hasActive = activeDayItems.length > 0;
              const hasOnlyClosed = !hasActive && dayItems.length > 0;

              const isTodayCell = cell.dateKey === todayKey;
              const isSelected = cell.dateKey === selectedKey;

              return (
                <button
                  key={cell.dateKey}
                  type="button"
                  onClick={() => {
                    setSelectedKey(cell.dateKey);
                    if (!cell.inCurrentMonth) {
                      setViewMonth({
                        year: cell.date.getFullYear(),
                        month: cell.date.getMonth(),
                      });
                    }
                  }}
                  aria-label={`${cell.date.toDateString()}, ${dayItems.length} reminders`}
                  aria-pressed={isSelected}
                  className={`relative min-h-[52px] sm:min-h-[64px] p-1.5 sm:p-2 rounded-2xl flex flex-col items-center justify-between transition-all ${
                    isSelected
                      ? 'bg-[#7657D5] text-white shadow-sm'
                      : isTodayCell
                        ? 'bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF] ring-1 ring-[#7657D5]/40'
                        : cell.inCurrentMonth
                          ? 'bg-[#FAF9FC] dark:bg-[#12101A]/75 hover:bg-[#EAE4FF]/50 dark:hover:bg-[#241F35] text-[#24212B] dark:text-[#F5F3FA]'
                          : 'text-[#A7A2B8] dark:text-[#57516B] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]/40'
                  }`}
                >
                  <span className="text-xs sm:text-sm font-semibold tabular-nums">
                    {cell.date.getDate()}
                  </span>

                  {/* Status dots */}
                  <div className="flex items-center gap-1 min-h-[10px]">
                    {hasOverdue && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-rose-500'
                        }`}
                      />
                    )}
                    {hasWaiting && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-[#EAE4FF]' : 'bg-amber-500'
                        }`}
                      />
                    )}
                    {hasActive && !hasOverdue && !hasWaiting && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-white' : 'bg-emerald-500'
                        }`}
                      />
                    )}
                    {hasOnlyClosed && (
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isSelected ? 'bg-white/70' : 'bg-[#D5CFE6] dark:bg-[#3D3656]'
                        }`}
                      />
                    )}
                    {activeDayItems.length > 1 && (
                      <span
                        className={`text-[10px] font-mono tabular-nums leading-none ${
                          isSelected ? 'text-white/90' : 'text-[#666173] dark:text-[#A7A2B8]'
                        }`}
                      >
                        {activeDayItems.length}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Minimal legend */}
          <div className="pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-wrap items-center gap-4 text-[11px] text-[#666173] dark:text-[#A7A2B8]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Overdue
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              Waiting
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Scheduled
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-[#EAE4FF] ring-1 ring-[#7657D5]" />
              Today
            </span>
          </div>
        </section>

        {/* Selected Day Agenda & Quick Scheduler */}
        <section
          aria-label="Selected day agenda"
          className="lg:col-span-5 space-y-4"
        >
          <div className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium text-[#7657D5] dark:text-[#B9A7F5]">
                  Day schedule
                </p>
                <h3 className="text-base sm:text-lg font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  {selectedLabel}
                </h3>
              </div>
              <button
                type="button"
                onClick={() =>
                  onAskOopsieForDay(
                    selectedDate.toLocaleDateString([], {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                    })
                  )
                }
                className="min-h-[44px] sm:min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#EAE4FF]/70 hover:bg-[#EAE4FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] text-xs font-medium text-[#4C32A8] dark:text-[#EAE4FF] transition-colors shrink-0"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Chat with Oopsie</span>
              </button>
            </div>

            {/* Quick schedule form right on this day */}
            <form
              onSubmit={handleQuickSchedule}
              className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A]/80 border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 space-y-2.5"
            >
              <input
                type="text"
                value={quickTitle}
                onChange={(e) => setQuickTitle(e.target.value)}
                placeholder={`Add something for ${selectedDate.toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                })}...`}
                className="w-full h-11 sm:h-10 px-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E899E] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="time"
                  value={quickTime}
                  onChange={(e) => setQuickTime(e.target.value)}
                  className="h-11 sm:h-9 px-2.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-xs text-[#24212B] dark:text-[#F5F3FA]"
                />
                <input
                  type="text"
                  value={quickPerson}
                  onChange={(e) => setQuickPerson(e.target.value)}
                  placeholder="Person (optional)"
                  className="flex-1 min-w-[120px] h-11 sm:h-9 px-2.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E899E] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                />
                <button
                  type="submit"
                  disabled={!quickTitle.trim()}
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] disabled:opacity-40 text-white text-xs font-medium transition-colors whitespace-nowrap shrink-0"
                >
                  <CalendarPlus className="w-3.5 h-3.5" />
                  <span>Schedule</span>
                </button>
              </div>
            </form>

            {/* Items for selected day */}
            {selectedItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#D5CFE6] dark:border-[#2C2740] p-6 text-center space-y-1.5">
                <p className="text-sm font-medium text-[#24212B] dark:text-[#F5F3FA]">
                  Wide open on {selectedDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                </p>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                  Add a follow-up above or chat with Oopsie to schedule something on this day.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <AnimatePresence>
                  {selectedItems.map((item) => (
                    <ReminderCard
                      key={item.id}
                      item={item}
                      allowInlineTimeline
                      onComplete={onComplete}
                      onSnoozeQuick={onSnoozeQuick}
                      onOpenTimeline={onOpenTimeline}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
