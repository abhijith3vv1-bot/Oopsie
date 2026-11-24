import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Check, Copy, RefreshCw, SendHorizontal } from 'lucide-react';
import type { AssistantMood, DailyBriefingResponse, ReminderItem, UserProfile } from '../types/reminder';
import { fetchDailyBriefing, isClientAiAnalysisPaused } from '../services/api';
import { auth } from '../firebase';
import { getDaysSince, isOverdue, isToday } from '../services/time';
import { AssistantOrb } from './AssistantOrb';

interface DailyBriefingCardProps {
  items: ReminderItem[];
  userProfile: UserProfile;
  assistantMood?: AssistantMood;
  onOpenItem: (itemId: string) => void;
}

export function DailyBriefingCard({
  items = [],
  userProfile,
  assistantMood = 'idle',
  onOpenItem,
}: DailyBriefingCardProps) {
  const [briefing, setBriefing] = useState<DailyBriefingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const hasFetchedForItemsRef = useRef(false);

  const safeItems = Array.isArray(items) ? items : [];
  const activeItems = safeItems.filter((i) => i.status !== 'closed');
  const hasOverdue = activeItems.some((i) => isOverdue(i));

  const computeLocalFallback = (): DailyBriefingResponse => {
    const hour = new Date().getHours();
    const greet =
      hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
    const todayCount = activeItems.filter((i) => isToday(i.dueAt)).length;
    const overdueCount = activeItems.filter((i) => isOverdue(i)).length;
    const waitingItems = activeItems.filter((i) => i.status === 'waiting');

    const staleNudges = waitingItems
      .filter((i) => getDaysSince(i.lastActivityAt) >= 2 || isOverdue(i))
      .slice(0, 2)
      .map((i) => ({
        itemId: i.id,
        person: i.person,
        reason: i.person
          ? `You haven't heard from ${i.person} in ${Math.max(1, getDaysSince(i.lastActivityAt))} days about "${i.title}".`
          : `"${i.title}" has been waiting for a few days.`,
        draftMessage: i.person
          ? `Hey ${i.person}, just checking in on "${i.title}"—any update when you get a chance?`
          : `Checking in on "${i.title}".`,
      }));

    let summary = "Forgot something? That's what I'm here for—tell me anything you want me to hold onto.";
    if (activeItems.length > 0) {
      const parts: string[] = [];
      if (todayCount > 0) parts.push(`you've got ${todayCount} thing${todayCount === 1 ? '' : 's'} today`);
      if (overdueCount > 0) parts.push(`${overdueCount} waiting from earlier`);
      if (waitingItems.length > 0 && waitingItems[0].person) {
        parts.push(`${waitingItems[0].person} still owes you an update`);
      }
      summary = parts.length > 0
        ? `Oopsie's got this 😄 Here's where things stand: ${parts.join(', ')}.`
        : `You have ${activeItems.length} open item${activeItems.length === 1 ? '' : 's'} tucked away safely.`;
    }

    return {
      greetingHeadline: `${greet}${userProfile?.name ? `, ${userProfile.name}` : ''}`,
      summaryText: summary,
      nudges: staleNudges,
    };
  };

  const loadBriefing = async () => {
    const fallback = computeLocalFallback();
    if (activeItems.length === 0) {
      setBriefing(null);
      return;
    }
    if (!auth.currentUser || isClientAiAnalysisPaused()) {
      setBriefing(fallback);
      return;
    }

    setLoading(true);
    try {
      const res = await fetchDailyBriefing({ items: safeItems, userProfile });
      setBriefing({
        greetingHeadline:
          typeof res?.greetingHeadline === 'string' && res.greetingHeadline.trim()
            ? res.greetingHeadline
            : fallback.greetingHeadline,
        summaryText:
          typeof res?.summaryText === 'string' && res.summaryText.trim()
            ? res.summaryText
            : fallback.summaryText,
        nudges: Array.isArray(res?.nudges)
          ? res.nudges.filter((n) => n && typeof n.itemId === 'string' && typeof n.reason === 'string')
          : fallback.nudges,
      });
    } catch {
      setBriefing(fallback);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeItems.length > 0 && !hasFetchedForItemsRef.current) {
      hasFetchedForItemsRef.current = true;
      loadBriefing();
    } else if (activeItems.length === 0) {
      setBriefing(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeItems.length]);

  const fallback = computeLocalFallback();
  const data = briefing ?? fallback;
  const nudges = Array.isArray(data?.nudges) ? data.nudges : [];

  const effectiveMood: AssistantMood = loading
    ? 'thinking'
    : assistantMood !== 'idle'
      ? assistantMood
      : hasOverdue
        ? 'oops'
        : 'idle';

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard blocked in some sandboxes
    }
  };

  return (
    <motion.section
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-3xl bg-gradient-to-br from-white via-[#FFFDF7] to-amber-50/70 dark:from-[#162038] dark:via-[#162038] dark:to-[#1E2A4A] border border-amber-200/70 dark:border-[#243252] p-5 sm:p-6 space-y-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3.5">
          <AssistantOrb mood={effectiveMood} size="md" />
          <div className="space-y-1">
            <h1 className="text-xl sm:text-2xl font-semibold font-display tracking-tight text-[#16213E] dark:text-slate-50 text-balance">
              {data.greetingHeadline || fallback.greetingHeadline}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
              {data.summaryText || fallback.summaryText}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadBriefing}
          disabled={loading}
          title="Refresh daily briefing"
          aria-label="Refresh daily briefing"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#16213E] dark:hover:text-slate-100 hover:bg-amber-100/60 dark:hover:bg-[#243252] transition-colors shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Smart Nudges for stale follow-ups */}
      {nudges.length > 0 && (
        <div className="pt-3 border-t border-amber-200/60 dark:border-[#243252] space-y-2.5">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Gentle nudges
          </p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {nudges.map((nudge) => (
              <div
                key={nudge.itemId}
                className="rounded-2xl bg-white/95 dark:bg-[#0E1525]/80 border border-amber-200/70 dark:border-[#243252] p-3.5 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs text-[#16213E] dark:text-slate-200 leading-relaxed">
                    {nudge.reason}
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpenItem(nudge.itemId)}
                    className="text-xs font-medium text-[#E2554E] dark:text-[#FF8A80] hover:underline whitespace-nowrap shrink-0"
                  >
                    Open
                  </button>
                </div>
                {nudge.draftMessage && (
                  <div className="flex items-center justify-between gap-2 rounded-xl bg-[#FFFBF4] dark:bg-[#162038] px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                    <span className="inline-flex items-center gap-1.5 min-w-0 truncate">
                      <SendHorizontal className="w-3.5 h-3.5 text-[#E2554E] shrink-0" />
                      <span className="truncate">"{nudge.draftMessage}"</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(nudge.itemId, nudge.draftMessage)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#16213E] dark:text-slate-200 hover:text-[#E2554E] dark:hover:text-[#FF8A80] whitespace-nowrap shrink-0"
                    >
                      {copiedId === nudge.itemId ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.section>
  );
}
