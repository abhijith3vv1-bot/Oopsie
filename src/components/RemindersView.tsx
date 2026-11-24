import { useMemo, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { ArrowUpDown, Plus, Search } from 'lucide-react';
import type { ReminderCategory, ReminderItem } from '../types/reminder';
import { isOverdue, isToday } from '../services/time';
import type { ReminderFilterTab } from './DashboardHome';
import { AssistantOrb } from './AssistantOrb';
import { ReminderCard } from './ReminderCard';

interface RemindersViewProps {
  items: ReminderItem[];
  liveNow: Date;
  activeFilter: ReminderFilterTab;
  onChangeFilter: (filter: ReminderFilterTab) => void;
  onOpenAddModal: () => void;
  onComplete: (item: ReminderItem) => void;
  onSnoozeQuick: (item: ReminderItem) => void;
  onOpenTimeline: (item: ReminderItem) => void;
}

type SortKey = 'due' | 'priority' | 'updated';

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

export function RemindersView({
  items,
  liveNow,
  activeFilter,
  onChangeFilter,
  onOpenAddModal,
  onComplete,
  onSnoozeQuick,
  onOpenTimeline,
}: RemindersViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | ReminderCategory>('all');
  const [sortBy, setSortBy] = useState<SortKey>('due');

  const counts = useMemo(() => {
    const active = items.filter((i) => i.status !== 'closed');
    return {
      all: items.length,
      today: active.filter((i) => isToday(i.dueAt, liveNow) && !isOverdue(i, liveNow)).length,
      upcoming: active.filter((i) => !isToday(i.dueAt, liveNow) && !isOverdue(i, liveNow)).length,
      overdue: active.filter((i) => isOverdue(i, liveNow)).length,
      waiting: active.filter((i) => i.status === 'waiting' || Boolean(i.person)).length,
      completed: items.filter((i) => i.status === 'closed').length,
    };
  }, [items, liveNow]);

  const filteredAndSorted = useMemo(() => {
    const q = search.trim().toLowerCase();

    const filtered = items.filter((item) => {
      if (activeFilter === 'today') {
        if (item.status === 'closed' || !isToday(item.dueAt, liveNow) || isOverdue(item, liveNow)) {
          return false;
        }
      } else if (activeFilter === 'upcoming') {
        if (item.status === 'closed' || isToday(item.dueAt, liveNow) || isOverdue(item, liveNow)) {
          return false;
        }
      } else if (activeFilter === 'overdue') {
        if (!isOverdue(item, liveNow)) return false;
      } else if (activeFilter === 'waiting') {
        if (item.status === 'closed' || (item.status !== 'waiting' && !item.person)) return false;
      } else if (activeFilter === 'completed') {
        if (item.status !== 'closed') return false;
      }

      if (categoryFilter !== 'all' && item.category !== categoryFilter) {
        return false;
      }

      if (q) {
        const matches =
          item.title.toLowerCase().includes(q) ||
          (item.person && item.person.toLowerCase().includes(q)) ||
          (item.project && item.project.toLowerCase().includes(q)) ||
          item.timeline.some((t) => t.text.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      if (activeFilter === 'all') {
        const aClosed = a.status === 'closed' ? 1 : 0;
        const bClosed = b.status === 'closed' ? 1 : 0;
        if (aClosed !== bClosed) return aClosed - bClosed;
      }
      if (sortBy === 'priority') {
        const pDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
        if (pDiff !== 0) return pDiff;
      }
      if (sortBy === 'updated') {
        return new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime();
      }
      return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    });
  }, [items, activeFilter, categoryFilter, search, sortBy, liveNow]);

  const filterTabs: Array<{ id: ReminderFilterTab; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'today', label: 'Today', count: counts.today },
    { id: 'upcoming', label: 'Upcoming', count: counts.upcoming },
    { id: 'overdue', label: 'Overdue', count: counts.overdue },
    { id: 'waiting', label: 'Waiting', count: counts.waiting },
    { id: 'completed', label: 'Completed', count: counts.completed },
  ];

  return (
    <section className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
            Reminders
          </h1>
          <p className="text-sm text-[#666173] dark:text-[#A7A2B8]">
            Swipe right on a card to log what happened next, or swipe left to snooze 1 hour.
          </p>
        </div>

        <button
          type="button"
          onClick={onOpenAddModal}
          className="min-h-[42px] inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span>New reminder</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {filterTabs.map((tab) => {
          const isActive = activeFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChangeFilter(tab.id)}
              className={`min-h-[38px] inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
                isActive
                  ? 'bg-[#7657D5] text-white'
                  : 'bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono tabular-nums text-[11px] ${
                  isActive ? 'text-white/80' : 'text-[#8E889C]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search, Category & Sort Bar */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#8E889C] absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search reminders, people, or conversation notes..."
            className="w-full h-11 pl-10 pr-3.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E889C] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as 'all' | ReminderCategory)}
            className="h-11 px-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA]"
          >
            <option value="all">All categories</option>
            <option value="Work">Work</option>
            <option value="Personal">Personal</option>
            <option value="Finance">Finance</option>
            <option value="Health">Health</option>
            <option value="Errands">Errands</option>
            <option value="Social">Social</option>
          </select>

          <div className="relative flex items-center">
            <ArrowUpDown className="w-3.5 h-3.5 text-[#8E889C] absolute left-3 pointer-events-none" />
            <select
              aria-label="Sort reminders"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
              className="h-11 pl-8 pr-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium text-[#24212B] dark:text-[#F5F3FA]"
            >
              <option value="due">Sort: Due date</option>
              <option value="priority">Sort: Priority</option>
              <option value="updated">Sort: Recently updated</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results List */}
      {filteredAndSorted.length === 0 ? (
        <div className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-10 text-center flex flex-col items-center space-y-3">
          <AssistantOrb mood="happy" size="md" />
          <p className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
            No reminders match this view
          </p>
          <p className="text-xs text-[#666173] dark:text-[#A7A2B8] max-w-sm">
            Try switching filters, clearing your search, or adding a new follow-up reminder.
          </p>
          <button
            type="button"
            onClick={onOpenAddModal}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>Add reminder</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          <AnimatePresence>
            {filteredAndSorted.map((item) => (
              <ReminderCard
                key={item.id}
                item={item}
                onComplete={onComplete}
                onSnoozeQuick={onSnoozeQuick}
                onOpenTimeline={onOpenTimeline}
                allowInlineTimeline
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
