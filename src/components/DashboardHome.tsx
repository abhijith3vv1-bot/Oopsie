import { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Link2,
  MessageSquareText,
  Plus,
  Sparkles,
  Users,
} from 'lucide-react';
import type {
  AssistantMood,
  ChatItemUpdate,
  ParsedReminderDraft,
  ReminderItem,
  UserProfile,
} from '../types/reminder';
import {
  formatDueLabel,
  formatTimelineTimestamp,
  getDaysSince,
  getPersonInitials,
  isOverdue,
  isToday,
} from '../services/time';
import { AssistantOrb } from './AssistantOrb';
import { CaptureBar } from './CaptureBar';
import { ReminderCard } from './ReminderCard';
import { MissedWhileAwayCard } from './MissedWhileAwayCard';

export type ReminderFilterTab = 'all' | 'today' | 'upcoming' | 'overdue' | 'waiting' | 'completed';

interface DashboardHomeProps {
  items: ReminderItem[];
  missedWhileAwayItems: ReminderItem[];
  userProfile: UserProfile;
  assistantMood: AssistantMood;
  liveNow: Date;
  captureInputRef: React.RefObject<HTMLTextAreaElement | null>;
  captureSeed: { text: string; key: number } | null;
  onOpenAddModal: () => void;
  onOpenConnect: () => void;
  onOpenRemindersFilter: (filter: ReminderFilterTab) => void;
  onOpenInsights: () => void;
  onOpenCalendar: () => void;
  onCreateItems: (drafts: ParsedReminderDraft[], rawUserMessage: string) => ReminderItem[];
  onApplyChatUpdate: (update: ChatItemUpdate, rawUserMessage: string) => ReminderItem | null;
  onOpenWhatHappened: (item: ReminderItem) => void;
  onOpenTimeline: (item: ReminderItem) => void;
  onSnoozeQuick: (item: ReminderItem) => void;
  onSnoozeTenMin: (item: ReminderItem) => void;
  onDismissMissed: () => void;
  onMoodChange: (mood: AssistantMood) => void;
}

export function DashboardHome({
  items,
  missedWhileAwayItems,
  userProfile,
  assistantMood,
  liveNow,
  captureInputRef,
  captureSeed,
  onOpenAddModal,
  onOpenConnect,
  onOpenRemindersFilter,
  onOpenInsights,
  onOpenCalendar,
  onCreateItems,
  onApplyChatUpdate,
  onOpenWhatHappened,
  onOpenTimeline,
  onSnoozeQuick,
  onSnoozeTenMin,
  onDismissMissed,
  onMoodChange,
}: DashboardHomeProps) {
  const activeItems = useMemo(
    () =>
      items
        .filter((i) => i.status !== 'closed')
        .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()),
    [items]
  );

  const overdueItems = useMemo(
    () => activeItems.filter((i) => isOverdue(i, liveNow)),
    [activeItems, liveNow]
  );

  const todayItems = useMemo(
    () => activeItems.filter((i) => isToday(i.dueAt, liveNow) && !isOverdue(i, liveNow)),
    [activeItems, liveNow]
  );

  const upcomingItems = useMemo(
    () => activeItems.filter((i) => !isToday(i.dueAt, liveNow) && !isOverdue(i, liveNow)),
    [activeItems, liveNow]
  );

  const waitingItems = useMemo(
    () => activeItems.filter((i) => i.status === 'waiting' || Boolean(i.person)),
    [activeItems]
  );

  const importantItems = useMemo(
    () =>
      activeItems
        .filter((i) => i.priority === 'high' || isOverdue(i, liveNow))
        .slice(0, 4),
    [activeItems, liveNow]
  );

  const recentlyUpdatedConversations = useMemo(
    () =>
      [...items]
        .filter((i) => i.timeline.length > 0)
        .sort(
          (a, b) =>
            new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
        )
        .slice(0, 4),
    [items]
  );

  const mightHaveForgotten = useMemo(
    () =>
      activeItems
        .filter(
          (i) =>
            isOverdue(i, liveNow) ||
            (i.status === 'waiting' && getDaysSince(i.lastActivityAt, liveNow) >= 2)
        )
        .slice(0, 4),
    [activeItems, liveNow]
  );

  const hour = liveNow.getHours();
  const timeGreeting =
    hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  const friendlySubline = useMemo(() => {
    if (overdueItems.length > 0) {
      return `Oops! Something is still waiting for you — ${overdueItems.length} item${overdueItems.length === 1 ? '' : 's'} need${overdueItems.length === 1 ? 's' : ''} a quick check-in.`;
    }
    if (waitingItems.length > 0) {
      return `Looks like you're waiting on ${waitingItems.length === 1 && waitingItems[0].person ? waitingItems[0].person : `${waitingItems.length} people`}. Oopsie is keeping every thread warm.`;
    }
    if (todayItems.length > 0) {
      return `You have ${todayItems.length} follow-up${todayItems.length === 1 ? '' : 's'} scheduled today. Should I check back after each one?`;
    }
    return 'All caught up! Enjoy your day.';
  }, [overdueItems.length, waitingItems, todayItems.length]);

  const effectiveMood: AssistantMood =
    assistantMood !== 'idle'
      ? assistantMood
      : overdueItems.length > 0
        ? 'oops'
        : activeItems.length === 0
          ? 'happy'
          : 'idle';

  const summaryCards = [
    {
      id: 'today' as const,
      label: 'Due Today',
      count: todayItems.length,
      icon: Clock,
      accent: 'text-[#7657D5] dark:text-[#C5B4FF]',
      bg: 'bg-[#EAE4FF]/70 dark:bg-[#2B2444]',
    },
    {
      id: 'upcoming' as const,
      label: 'Upcoming',
      count: upcomingItems.length,
      icon: CalendarClock,
      accent: 'text-sky-600 dark:text-sky-400',
      bg: 'bg-sky-50 dark:bg-sky-950/40',
    },
    {
      id: 'waiting' as const,
      label: 'Waiting for Response',
      count: waitingItems.length,
      icon: Users,
      accent: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/40',
    },
    {
      id: 'overdue' as const,
      label: 'Overdue',
      count: overdueItems.length,
      icon: AlertCircle,
      accent: 'text-[#D9534F] dark:text-[#FCA5A5]',
      bg: 'bg-rose-50 dark:bg-rose-950/40',
    },
  ];

  return (
    <div className="space-y-7">
      <MissedWhileAwayCard
        items={missedWhileAwayItems}
        onDone={onOpenWhatHappened}
        onSnoozeTenMin={onSnoozeTenMin}
        onOpenItem={onOpenTimeline}
        onDismiss={onDismissMissed}
      />

      {/* Welcome Hero Banner */}
      <motion.section
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <AssistantOrb mood={effectiveMood} size="md" />
            <div className="space-y-1">
              <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-[#24212B] dark:text-[#F5F3FA] text-balance">
                {timeGreeting}
                {userProfile.name ? `, ${userProfile.name}` : ''}
              </h1>
              <p className="text-sm text-[#666173] dark:text-[#A7A2B8] leading-relaxed max-w-2xl">
                {friendlySubline}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onOpenConnect}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#DDD3FA] dark:border-[#3D3363] bg-[#EAE4FF]/55 dark:bg-[#2B2444] hover:border-[#7657D5] text-xs font-semibold text-[#4C32A8] dark:text-[#EAE4FF] whitespace-nowrap transition-colors"
            >
              <Link2 className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF]" />
              <span>Connect</span>
            </button>
            <button
              type="button"
              onClick={onOpenInsights}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] hover:border-[#7657D5]/60 text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap transition-colors"
            >
              <BarChart3 className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF]" />
              <span>Insights</span>
            </button>
            <button
              type="button"
              onClick={onOpenAddModal}
              className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-xs sm:text-sm font-semibold shadow-sm whitespace-nowrap transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add Reminder</span>
            </button>
          </div>
        </div>
      </motion.section>

      {/* 4 Summary Cards */}
      <section aria-label="Reminder summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
        {summaryCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => onOpenRemindersFilter(card.id)}
              className="group text-left rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5]/60 p-3.5 sm:p-4 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className={`w-9 h-9 rounded-xl ${card.bg} ${card.accent} flex items-center justify-center`}>
                  <Icon className="w-4 h-4" />
                </span>
                <ArrowRight className="w-4 h-4 text-[#A7A2B8] opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <p className="mt-3 text-2xl font-bold font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA]">
                {card.count}
              </p>
              <p className="mt-0.5 text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                {card.label}
              </p>
            </button>
          );
        })}
      </section>

      {/* Conversational Quick-Add Bar */}
      <CaptureBar
        userProfile={userProfile}
        items={items}
        onCreateItems={onCreateItems}
        onApplyChatUpdate={onApplyChatUpdate}
        onOpenItem={(id) => {
          const found = items.find((it) => it.id === id);
          if (found) onOpenTimeline(found);
        }}
        onMoodChange={onMoodChange}
        inputRef={captureInputRef}
        seedPrompt={captureSeed}
      />

      {/* Things you might have forgotten */}
      {mightHaveForgotten.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                Things you might have forgotten
              </h2>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Hey, remember this conversation? Check in to decide what comes next.
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenRemindersFilter('overdue')}
              className="text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF] hover:underline whitespace-nowrap"
            >
              Review all
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {mightHaveForgotten.map((item) => {
              const daysAgo = getDaysSince(item.lastActivityAt, liveNow);
              return (
                <div
                  key={item.id}
                  className="rounded-2xl bg-[#EAE4FF]/45 dark:bg-[#2B2444]/55 border border-[#DDD3FA] dark:border-[#3D3363] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div
                    className="min-w-0 flex-1 cursor-pointer"
                    onClick={() => onOpenTimeline(item)}
                  >
                    <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                      {item.title}
                    </p>
                    <p className="mt-1 text-xs text-[#666173] dark:text-[#A7A2B8] truncate">
                      {item.person ? `${item.person} · ` : ''}
                      {isOverdue(item, liveNow)
                        ? `Due ${formatDueLabel(item.dueAt, liveNow)}`
                        : `Last update ${daysAgo}d ago`}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenWhatHappened(item)}
                    className="w-full sm:w-auto min-h-[44px] sm:min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-xs font-semibold whitespace-nowrap shrink-0 transition-colors"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>What happened?</span>
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Main 2-Column Content: Today's Follow-ups + Important & Recent Conversations */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        <div className="lg:col-span-7 space-y-6">
          {/* Today's Follow-ups */}
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                Today&apos;s follow-ups
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
                {todayItems.length}
              </span>
            </div>

            {todayItems.length === 0 && overdueItems.length === 0 ? (
              <div className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-8 text-center flex flex-col items-center space-y-3">
                <AssistantOrb mood="happy" size="lg" />
                <p className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  All caught up! Enjoy your day.
                </p>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8] max-w-sm">
                  Tap Add Reminder whenever you start a conversation or promise that shouldn&apos;t slip through the cracks.
                </p>
                <button
                  type="button"
                  onClick={onOpenAddModal}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-xs font-semibold hover:bg-[#7657D5] hover:text-white transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  <span>Add your next follow-up</span>
                </button>
              </div>
            ) : todayItems.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#DDD3FA] dark:border-[#3D3363] p-6 text-center text-xs text-[#666173] dark:text-[#A7A2B8]">
                Nothing else scheduled for today. Check &quot;Things you might have forgotten&quot; above!
              </div>
            ) : (
              <div className="space-y-3">
                {todayItems.map((item) => (
                  <ReminderCard
                    key={item.id}
                    item={item}
                    onComplete={onOpenWhatHappened}
                    onSnoozeQuick={onSnoozeQuick}
                    onOpenTimeline={onOpenTimeline}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Important Reminders */}
          {importantItems.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Important reminders
                </h2>
                <button
                  type="button"
                  onClick={() => onOpenRemindersFilter('all')}
                  className="text-xs font-medium text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
                >
                  See all
                </button>
              </div>
              <div className="space-y-3">
                {importantItems.map((item) => (
                  <ReminderCard
                    key={item.id}
                    item={item}
                    onComplete={onOpenWhatHappened}
                    onSnoozeQuick={onSnoozeQuick}
                    onOpenTimeline={onOpenTimeline}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Right Column: Recently Updated Conversations + Pending People + Quick Links */}
        <div className="lg:col-span-5 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                Recently updated conversations
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
                {recentlyUpdatedConversations.length}
              </span>
            </div>

            {recentlyUpdatedConversations.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#DDD3FA] dark:border-[#3D3363] p-6 text-center text-xs text-[#666173] dark:text-[#A7A2B8]">
                Your conversation updates and timelines will appear here.
              </div>
            ) : (
              <div className="space-y-2.5">
                {recentlyUpdatedConversations.map((conv) => {
                  const latest = conv.timeline[conv.timeline.length - 1];
                  return (
                    <button
                      key={conv.id}
                      type="button"
                      onClick={() => onOpenTimeline(conv)}
                      className="w-full text-left rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5]/60 p-4 transition-colors space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-7 h-7 rounded-full bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-[11px] font-semibold flex items-center justify-center shrink-0">
                            {getPersonInitials(conv.person) || (
                              <MessageSquareText className="w-3.5 h-3.5" />
                            )}
                          </span>
                          <span className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                            {conv.title}
                          </span>
                        </div>
                        {conv.status === 'closed' && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        )}
                      </div>
                      {latest && (
                        <p className="text-xs text-[#666173] dark:text-[#A7A2B8] line-clamp-2 leading-relaxed">
                          {latest.text}
                        </p>
                      )}
                      <div className="flex items-center justify-between text-[11px] text-[#8E889C] font-mono tabular-nums">
                        <span>{conv.person || conv.category}</span>
                        <span>{formatTimelineTimestamp(conv.lastActivityAt)}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Quick Pending People & Calendar Access */}
          <section className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
                Quick access
              </h3>
              <button
                type="button"
                onClick={onOpenCalendar}
                className="text-xs font-medium text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
              >
                Open Calendar
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onOpenRemindersFilter('waiting')}
                className="p-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#EFEBF7] dark:border-[#2C2740] hover:border-[#7657D5]/60 text-left transition-colors"
              >
                <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                  Pending replies
                </p>
                <p className="mt-0.5 text-xs font-mono tabular-nums text-[#7657D5] dark:text-[#C5B4FF]">
                  {waitingItems.length} waiting
                </p>
              </button>
              <button
                type="button"
                onClick={onOpenInsights}
                className="p-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#EFEBF7] dark:border-[#2C2740] hover:border-[#7657D5]/60 text-left transition-colors"
              >
                <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                  Productivity stats
                </p>
                <p className="mt-0.5 text-xs font-mono tabular-nums text-[#7657D5] dark:text-[#C5B4FF]">
                  View Insights
                </p>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
