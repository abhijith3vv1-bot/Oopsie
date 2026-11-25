import { useState } from 'react';
import { motion, type PanInfo } from 'motion/react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  MessageSquareText,
  RotateCw,
  Sparkles,
} from 'lucide-react';
import type { ReminderItem } from '../types/reminder';
import {
  formatDueLabel,
  formatTimelineTimestamp,
  getPersonInitials,
  isOverdue,
} from '../services/time';

interface ReminderCardProps {
  item: ReminderItem;
  onComplete: (item: ReminderItem) => void;
  onSnoozeQuick: (item: ReminderItem) => void;
  onOpenTimeline: (item: ReminderItem) => void;
  allowInlineTimeline?: boolean;
}

const AVATAR_TONES = [
  'bg-[#EAE4FF] text-[#5B3FC2] dark:bg-[#2B2444] dark:text-[#C5B4FF]',
  'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
  'bg-amber-100 text-amber-900 dark:bg-amber-950/70 dark:text-amber-300',
  'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
  'bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300',
];

function getAvatarTone(name: string | null): string {
  if (!name) return 'bg-[#F3F0FA] text-[#24212B] dark:bg-[#2B2444] dark:text-[#EAE4FF]';
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return AVATAR_TONES[sum % AVATAR_TONES.length];
}

export function ReminderCard({
  item,
  onComplete,
  onSnoozeQuick,
  onOpenTimeline,
  allowInlineTimeline = false,
}: ReminderCardProps) {
  const [expandedTimeline, setExpandedTimeline] = useState(false);
  const [swipeHint, setSwipeHint] = useState<'complete' | 'snooze' | null>(null);

  const overdue = isOverdue(item);
  const initials = getPersonInitials(item.person);
  const dueText = formatDueLabel(item.dueAt);

  const statusLabel =
    item.status === 'closed'
      ? 'Completed'
      : overdue
        ? 'Overdue'
        : item.status === 'waiting'
          ? item.person
            ? `Waiting on ${item.person}`
            : 'Waiting for response'
          : 'Active';

  const statusColor =
    item.status === 'closed'
      ? 'text-[#666173] dark:text-[#A7A2B8]'
      : overdue
        ? 'text-[#D9534F] dark:text-[#FCA5A5] font-semibold'
        : item.status === 'waiting'
          ? 'text-[#B45309] dark:text-amber-300 font-medium'
          : 'text-emerald-700 dark:text-emerald-400 font-medium';

  const latestNote =
    item.timeline.length > 0 ? item.timeline[item.timeline.length - 1] : null;

  const handleDrag = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (item.status === 'closed') return;
    if (info.offset.x > 55) setSwipeHint('complete');
    else if (info.offset.x < -55) setSwipeHint('snooze');
    else setSwipeHint(null);
  };

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    setSwipeHint(null);
    if (item.status === 'closed') return;
    if (info.offset.x > 90) {
      onComplete(item);
    } else if (info.offset.x < -90) {
      onSnoozeQuick(item);
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Subtle swipe feedback layer */}
      {item.status !== 'closed' && swipeHint && (
        <div
          aria-hidden="true"
          className={`absolute inset-0 flex items-center px-5 text-xs font-semibold ${
            swipeHint === 'complete'
              ? 'justify-start bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'justify-end bg-amber-500/15 text-amber-700 dark:text-amber-300'
          }`}
        >
          {swipeHint === 'complete' ? 'Release for What Happened?' : 'Release to Snooze 1h'}
        </div>
      )}

      <motion.article
        layout
        drag={item.status !== 'closed' ? 'x' : false}
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.28}
        onDrag={handleDrag}
        onDragEnd={handleDragEnd}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98 }}
        transition={{ duration: 0.16 }}
        className={`relative group rounded-2xl border bg-white dark:bg-[#1A1726] p-3.5 sm:p-4 transition-colors ${
          overdue && item.status !== 'closed'
            ? 'border-[#D9534F]/45 dark:border-[#FCA5A5]/35'
            : 'border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5]/55 dark:hover:border-[#7657D5]/60'
        }`}
      >
        <div className="flex items-start gap-2.5 sm:gap-3.5">
          {/* Person initials or category mark */}
          <button
            type="button"
            onClick={() => onOpenTimeline(item)}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 mt-0.5 transition-transform active:scale-95 ${getAvatarTone(
              item.person
            )}`}
            aria-label={`Open timeline for ${item.title}`}
          >
            {initials || item.category.slice(0, 2).toUpperCase()}
          </button>

          {/* Core content */}
          <div
            className="flex-1 min-w-0 cursor-pointer"
            onClick={() => onOpenTimeline(item)}
          >
            <h3
              className={`text-[15px] font-semibold leading-snug ${
                item.status === 'closed'
                  ? 'line-through text-[#8E889C] dark:text-[#78728A]'
                  : 'text-[#24212B] dark:text-[#F5F3FA]'
              }`}
            >
              {item.title}
            </h3>

            {/* Unboxed clean metadata with typographic separators */}
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#666173] dark:text-[#A7A2B8]">
              <span className={statusColor}>{statusLabel}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{dueText}</span>
              <span aria-hidden="true">·</span>
              <span>{item.category}</span>
              {item.priority === 'high' && item.status !== 'closed' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-[#D9534F] dark:text-[#FCA5A5] font-medium">
                    High priority
                  </span>
                </>
              )}
              {item.followUpRule.enabled && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-1 text-[#7657D5] dark:text-[#C5B4FF]">
                    <RotateCw className="w-3 h-3" />
                    {item.followUpRule.intervalDays
                      ? `Every ${item.followUpRule.intervalDays}d`
                      : item.followUpRule.description?.startsWith('Condition:')
                        ? 'Conditional'
                        : 'Follow-up'}
                  </span>
                </>
              )}
            </div>

            {latestNote && item.timeline.length > 0 && (
              <p className="mt-2 text-xs text-[#666173] dark:text-[#A7A2B8] line-clamp-1">
                {latestNote.text}
              </p>
            )}
          </div>

          {/* Touch-friendly quick actions */}
          <div className="flex items-center gap-1 shrink-0">
            {item.status !== 'closed' && (
              <>
                <button
                  type="button"
                  onClick={() => onSnoozeQuick(item)}
                  title="Snooze 1 hour"
                  aria-label={`Snooze ${item.title} for 1 hour`}
                  className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#2B2444] transition-colors"
                >
                  <Clock className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onComplete(item)}
                  title="What happened next?"
                  aria-label={`Check in on ${item.title}`}
                  className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] inline-flex items-center justify-center gap-1 px-2.5 rounded-xl bg-[#EAE4FF]/70 dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] hover:bg-[#7657D5] hover:text-white transition-colors text-xs font-semibold"
                >
                  {item.followUpRule.enabled || item.person ? (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline whitespace-nowrap">Next?</span>
                    </>
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                </button>
              </>
            )}
            {allowInlineTimeline && item.timeline.length > 0 ? (
              <button
                type="button"
                onClick={() => setExpandedTimeline((v) => !v)}
                aria-label={expandedTimeline ? 'Collapse timeline' : 'Expand timeline'}
                className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#7657D5] dark:hover:text-[#C5B4FF] hover:bg-[#FAF9FC] dark:hover:bg-[#2B2444] transition-colors"
              >
                {expandedTimeline ? (
                  <ChevronUp className="w-4 h-4" />
                ) : (
                  <ChevronDown className="w-4 h-4" />
                )}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onOpenTimeline(item)}
                title="Open conversation timeline"
                aria-label={`Open timeline for ${item.title}`}
                className="min-w-[44px] min-h-[44px] sm:min-w-[40px] sm:min-h-[40px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#7657D5] dark:hover:text-[#C5B4FF] hover:bg-[#FAF9FC] dark:hover:bg-[#2B2444] transition-colors"
              >
                <MessageSquareText className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Expandable inline conversation timeline */}
        {allowInlineTimeline && expandedTimeline && item.timeline.length > 0 && (
          <div className="mt-3.5 pt-3.5 border-t border-[#EFEBF7] dark:border-[#2C2740] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                Conversation timeline
              </span>
              <button
                type="button"
                onClick={() => onOpenTimeline(item)}
                className="font-medium text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
              >
                Add update
              </button>
            </div>
            <ol className="space-y-2 pl-3 border-l border-[#DDD3FA] dark:border-[#3D3363] ml-1.5">
              {item.timeline.map((entry) => (
                <li key={entry.id} className="text-xs leading-relaxed">
                  <span className="font-mono text-[11px] text-[#8E889C] mr-2">
                    {formatTimelineTimestamp(entry.timestamp)}
                  </span>
                  <span className="text-[#24212B] dark:text-[#F5F3FA]">{entry.text}</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </motion.article>
    </div>
  );
}
