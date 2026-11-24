import { Check, Clock, Sparkles, X } from 'lucide-react';
import type { ReminderItem } from '../types/reminder';
import { formatDueLabel } from '../services/time';
import { AssistantOrb } from './AssistantOrb';

interface MissedWhileAwayCardProps {
  items: ReminderItem[];
  onDone: (item: ReminderItem) => void;
  onSnoozeTenMin: (item: ReminderItem) => void;
  onOpenItem: (item: ReminderItem) => void;
  onDismiss: () => void;
}

export function MissedWhileAwayCard({
  items,
  onDone,
  onSnoozeTenMin,
  onOpenItem,
  onDismiss,
}: MissedWhileAwayCardProps) {
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Missed reminders while away"
      className="rounded-3xl bg-[#EAE4FF]/55 dark:bg-[#221D35] border border-[#C6B9F2] dark:border-[#3D3361] p-5 sm:p-6 space-y-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <AssistantOrb mood="oops" size="sm" />
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7657D5] dark:text-[#B9A7F5]">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Catch-up summary</span>
            </div>
            <h2 className="text-base sm:text-lg font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
              While you were away, Oopsie noticed {items.length}{' '}
              {items.length === 1 ? 'follow-up' : 'follow-ups'}
            </h2>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss missed reminders summary"
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-white/70 dark:hover:bg-[#2B2444]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-2.5">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5"
          >
            <button
              type="button"
              onClick={() => onOpenItem(item)}
              className="text-left min-w-0 flex-1"
            >
              <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA] truncate">
                {item.title}
              </p>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] mt-0.5 tabular-nums">
                Due {formatDueLabel(item.dueAt)}
                {item.person ? ` · With ${item.person}` : ''}
              </p>
            </button>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onDone(item)}
                className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-medium transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>What happened?</span>
              </button>
              <button
                type="button"
                onClick={() => onSnoozeTenMin(item)}
                className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-[#FAF9FC] dark:bg-[#241F35] hover:bg-[#EAE4FF] dark:hover:bg-[#2E2747] text-[#24212B] dark:text-[#F5F3FA] text-xs font-medium transition-colors"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Snooze 10m</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
