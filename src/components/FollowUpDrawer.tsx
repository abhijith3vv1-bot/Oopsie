import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Calendar,
  CheckCircle2,
  RotateCw,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type {
  ReminderItem,
  UpdateSummaryResponse,
  UserProfile,
} from '../types/reminder';
import { generateCheckInQuestion, submitFollowUpUpdate } from '../services/api';
import {
  adjustOutOfQuietHours,
  formatDueLabel,
  formatTimelineTimestamp,
} from '../services/time';
import { AssistantOrb } from './AssistantOrb';

interface FollowUpDrawerProps {
  item: ReminderItem;
  userProfile: UserProfile;
  triggerCheckInOnOpen: boolean;
  onUpdateItem: (updated: ReminderItem, closedJustNow?: boolean) => void;
  onOpenWhatHappened?: (item: ReminderItem) => void;
  onDeleteItem: (itemId: string) => void;
  onClose: () => void;
}

export function FollowUpDrawer({
  item,
  userProfile,
  triggerCheckInOnOpen,
  onUpdateItem,
  onOpenWhatHappened,
  onDeleteItem,
  onClose,
}: FollowUpDrawerProps) {
  const [checkInQuestion, setCheckInQuestion] = useState<string | null>(null);
  const [quickReplies, setQuickReplies] = useState<string[]>([]);
  const [loadingQuestion, setLoadingQuestion] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [submittingReply, setSubmittingReply] = useState(false);
  const [pendingProposal, setPendingProposal] = useState<UpdateSummaryResponse | null>(null);
  const [customNextIso, setCustomNextIso] = useState<string>('');
  const [showCustomPicker, setShowCustomPicker] = useState(false);

  const [ruleIntervalDays, setRuleIntervalDays] = useState<string>(
    item.followUpRule.intervalDays ? String(item.followUpRule.intervalDays) : ''
  );

  useEffect(() => {
    setRuleIntervalDays(
      item.followUpRule.intervalDays ? String(item.followUpRule.intervalDays) : ''
    );
  }, [item.id, item.followUpRule.intervalDays]);

  useEffect(() => {
    if (!triggerCheckInOnOpen || item.status === 'closed') return;
    let active = true;
    setLoadingQuestion(true);
    generateCheckInQuestion(item, userProfile)
      .then((res) => {
        if (!active) return;
        setCheckInQuestion(res.question);
        setQuickReplies(res.quickReplies || []);
      })
      .catch(() => {
        if (!active) return;
        setCheckInQuestion(
          item.person
            ? `Did ${item.person} get back to you about "${item.title}"? What happened?`
            : `How did "${item.title}" go? Is it wrapped up or do we need a follow-up?`
        );
        setQuickReplies(['All done, close it', 'Waiting on their reply', 'Check again in 2 days']);
      })
      .finally(() => {
        if (active) setLoadingQuestion(false);
      });

    return () => {
      active = false;
    };
  }, [item.id, triggerCheckInOnOpen]);

  const handleSendUpdate = async (textToSend?: string) => {
    const finalReply = (textToSend ?? replyText).trim();
    if (!finalReply || submittingReply) return;

    setSubmittingReply(true);
    setReplyText('');
    const nowIso = new Date().toISOString();

    try {
      const result = await submitFollowUpUpdate({
        item,
        userReply: finalReply,
        userProfile,
      });

      const userEntry = {
        id: crypto.randomUUID(),
        type: 'user_update' as const,
        text: finalReply,
        timestamp: nowIso,
      };
      const summaryEntry = {
        id: crypto.randomUUID(),
        type: 'ai_summary' as const,
        text: result.summary,
        timestamp: nowIso,
      };

      const nextStatus = result.isResolved ? 'closed' : result.suggestedStatus;
      const adjustedNextDue = result.nextFollowUpIso
        ? adjustOutOfQuietHours(result.nextFollowUpIso, userProfile)
        : item.dueAt;

      const updated: ReminderItem = {
        ...item,
        status: nextStatus,
        dueAt: result.isResolved ? item.dueAt : adjustedNextDue,
        lastActivityAt: nowIso,
        closedAt: result.isResolved ? nowIso : null,
        timeline: [
          ...item.timeline,
          ...(checkInQuestion
            ? [
                {
                  id: crypto.randomUUID(),
                  type: 'checkin_asked' as const,
                  text: checkInQuestion,
                  timestamp: nowIso,
                },
              ]
            : []),
          userEntry,
          summaryEntry,
          ...(result.isResolved
            ? [
                {
                  id: crypto.randomUUID(),
                  type: 'closed' as const,
                  text: 'Loop marked closed.',
                  timestamp: nowIso,
                },
              ]
            : []),
        ],
      };

      onUpdateItem(updated, result.isResolved);
      setCheckInQuestion(null);
      setPendingProposal(result);
    } catch {
      const nowFallback = new Date().toISOString();
      const updated: ReminderItem = {
        ...item,
        status: 'waiting',
        lastActivityAt: nowFallback,
        timeline: [
          ...item.timeline,
          {
            id: crypto.randomUUID(),
            type: 'user_update',
            text: finalReply,
            timestamp: nowFallback,
          },
        ],
      };
      onUpdateItem(updated, false);
      setPendingProposal({
        summary: finalReply,
        isResolved: false,
        suggestedStatus: 'waiting',
        nextFollowUpIso: new Date(Date.now() + 2 * 86400000).toISOString(),
        nextFollowUpLabel: 'In 2 days',
        assistantReply: 'Saved your note! Want me to check back in 2 days, or pick a different time?',
      });
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleCloseLoop = () => {
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
          text: 'Marked as closed.',
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, true);
    setPendingProposal(null);
  };

  const handleReopenLoop = () => {
    const nowIso = new Date().toISOString();
    const nextDue = adjustOutOfQuietHours(new Date(Date.now() + 86400000).toISOString(), userProfile);
    const updated: ReminderItem = {
      ...item,
      status: 'needs_action',
      dueAt: nextDue,
      closedAt: null,
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        {
          id: crypto.randomUUID(),
          type: 'reopened',
          text: 'Follow-up reopened.',
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, false);
  };

  const handleSaveRule = () => {
    const days = Number(ruleIntervalDays);
    const enabled = !Number.isNaN(days) && days > 0;
    const updated: ReminderItem = {
      ...item,
      followUpRule: {
        enabled,
        intervalDays: enabled ? days : null,
        description: enabled ? `Check every ${days} day${days === 1 ? '' : 's'} until resolved` : null,
      },
    };
    onUpdateItem(updated, false);
  };

  const applyCustomNextFollowUp = () => {
    if (!customNextIso) return;
    const iso = new Date(customNextIso).toISOString();
    const nowIso = new Date().toISOString();
    const updated: ReminderItem = {
      ...item,
      dueAt: iso,
      status: item.person ? 'waiting' : 'needs_action',
      lastActivityAt: nowIso,
      timeline: [
        ...item.timeline,
        {
          id: crypto.randomUUID(),
          type: 'rescheduled',
          text: `Next check-in scheduled for ${formatDueLabel(iso)}.`,
          timestamp: nowIso,
        },
      ],
    };
    onUpdateItem(updated, false);
    setShowCustomPicker(false);
    setPendingProposal(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#24212B]/45 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="drawer-title"
    >
      <div className="flex-1 hidden sm:block" onClick={onClose} />
      <motion.aside
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="w-full sm:max-w-lg h-[100dvh] bg-white dark:bg-[#1A1726] border-l border-[#E6E1F2] dark:border-[#2C2740] flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="px-5 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 sm:py-4 border-b border-[#E6E1F2] dark:border-[#2C2740] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#666173] dark:text-[#A7A2B8]">
              <span>{item.category}</span>
              {item.person && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{item.person}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {item.status === 'closed' ? 'Closed' : formatDueLabel(item.dueAt)}
              </span>
            </div>
            <h2
              id="drawer-title"
              className="mt-1 text-lg font-semibold font-display text-[#24212B] dark:text-[#F5F3FA] leading-snug"
            >
              {item.title}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close timeline"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">
          {/* Quick jump to Signature Check-in */}
          {item.status !== 'closed' && onOpenWhatHappened && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-[#EAE4FF]/60 dark:bg-[#2B2444] border border-[#D5CFE6] dark:border-[#3D3361] px-4 py-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#4C32A8] dark:text-[#EAE4FF]">
                  Ready to update status?
                </p>
                <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">
                  Record outcome, still waiting, or a new conversation.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onOpenWhatHappened(item)}
                className="min-h-[44px] w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>What happened?</span>
              </button>
            </div>
          )}

          {/* Assistant Check-in Card */}
          {(loadingQuestion || checkInQuestion || pendingProposal) && (
            <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3">
              <div className="flex items-start gap-3">
                <AssistantOrb
                  mood={loadingQuestion || submittingReply ? 'thinking' : pendingProposal?.isResolved ? 'happy' : 'idle'}
                  size="sm"
                />
                <div className="flex-1 text-sm text-[#24212B] dark:text-[#F5F3FA] leading-relaxed">
                  {loadingQuestion
                    ? 'Oopsie is pulling up your thread...'
                    : pendingProposal
                      ? pendingProposal.assistantReply
                      : checkInQuestion}
                </div>
              </div>

              {!loadingQuestion && checkInQuestion && quickReplies.length > 0 && (
                <div className="flex flex-wrap gap-2 pl-0 sm:pl-11">
                  {quickReplies.map((qr) => (
                    <button
                      key={qr}
                      type="button"
                      onClick={() => handleSendUpdate(qr)}
                      className="min-h-[44px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium text-[#24212B] dark:text-[#EAE4FF] hover:bg-[#EAE4FF]/50 dark:hover:bg-[#2B2444] transition-colors"
                    >
                      {qr}
                    </button>
                  ))}
                </div>
              )}

              {pendingProposal && !pendingProposal.isResolved && (
                <div className="flex flex-wrap items-center gap-2 pl-0 sm:pl-11 pt-1">
                  <button
                    type="button"
                    onClick={() => setPendingProposal(null)}
                    className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-medium"
                  >
                    Accept ({pendingProposal.nextFollowUpLabel || 'scheduled'})
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCustomPicker((v) => !v)}
                    className="min-h-[44px] px-3 py-1.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium"
                  >
                    Change date
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseLoop}
                    className="min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    Close loop
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Custom schedule picker */}
          {showCustomPicker && (
            <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <input
                type="datetime-local"
                value={customNextIso}
                onChange={(e) => setCustomNextIso(e.target.value)}
                className="w-full sm:flex-1 sm:min-w-[180px] h-11 px-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-xs"
              />
              <button
                type="button"
                onClick={applyCustomNextFollowUp}
                className="min-h-[44px] px-4 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-medium shrink-0"
              >
                Schedule
              </button>
            </div>
          )}

          {/* Recurring / Condition Rule */}
          <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A]/75 border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-[#7657D5]" />
                Follow-up rule
              </span>
              <span className="text-xs text-[#666173] dark:text-[#A7A2B8] truncate max-w-full sm:max-w-[220px]">
                {item.followUpRule.description ||
                  (item.followUpRule.enabled && item.followUpRule.intervalDays
                    ? `Every ${item.followUpRule.intervalDays}d`
                    : 'One-off')}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-[#666173] dark:text-[#A7A2B8]">Check every</span>
              <input
                type="number"
                min="0"
                max="60"
                value={ruleIntervalDays}
                onChange={(e) => setRuleIntervalDays(e.target.value)}
                placeholder="2"
                className="w-16 h-9 px-2.5 rounded-lg bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-mono text-center"
              />
              <span className="text-xs text-[#666173] dark:text-[#A7A2B8]">days until resolved</span>
              <button
                type="button"
                onClick={handleSaveRule}
                className="ml-auto min-h-[44px] px-3.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium hover:bg-[#EAE4FF]/50 dark:hover:bg-[#241F35]"
              >
                Save rule
              </button>
            </div>
          </div>

          {/* Chronological Conversation Timeline */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-[#666173] dark:text-[#A7A2B8] uppercase tracking-wide">
              Conversation Timeline
            </h3>
            <ol className="relative space-y-4 pl-4 border-l border-[#E6E1F2] dark:border-[#2C2740] ml-2">
              {item.timeline.map((entry) => {
                const isUser = entry.type === 'user_update';
                const isSummary = entry.type === 'ai_summary';
                const isClosed = entry.type === 'closed';
                return (
                  <li key={entry.id} className="relative pl-3">
                    <span
                      aria-hidden="true"
                      className={`absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-[#1A1726] ${
                        isClosed
                          ? 'bg-emerald-500'
                          : isUser
                            ? 'bg-[#7657D5]'
                            : isSummary
                              ? 'bg-[#B9A7F5]'
                              : 'bg-[#D5CFE6] dark:bg-[#493E70]'
                      }`}
                    />
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[#8E899E] dark:text-[#7F7994]">
                      <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">
                        {isUser
                          ? 'Your update'
                          : isSummary
                            ? 'Outcome / summary'
                            : entry.type === 'checkin_asked'
                              ? 'Oopsie check-in'
                              : entry.type === 'snoozed'
                                ? 'Snoozed'
                                : entry.type === 'rescheduled'
                                  ? 'Rescheduled'
                                  : entry.type === 'closed'
                                    ? 'Closed'
                                    : entry.type === 'created'
                                      ? 'Created'
                                      : 'Event'}
                      </span>
                      <span className="font-mono tabular-nums">
                        {formatTimelineTimestamp(entry.timestamp)}
                      </span>
                    </div>
                    <p
                      className={`mt-1 text-sm leading-relaxed ${
                        isUser
                          ? 'text-[#24212B] dark:text-[#F5F3FA] font-medium'
                          : 'text-[#666173] dark:text-[#A7A2B8]'
                      }`}
                    >
                      {entry.text}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* Footer: Reply input + Loop Status Controls */}
        <div className="p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A]/95 space-y-3">
          {item.status !== 'closed' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendUpdate();
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Log an update (e.g. 'Vendor asked for one more day')..."
                className="min-w-0 flex-1 h-11 px-3.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-sm focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
              />
              <button
                type="submit"
                disabled={!replyText.trim() || submittingReply}
                className="min-h-[44px] px-4 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] disabled:opacity-40 text-white text-sm font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <span>{submittingReply ? 'Saving...' : 'Update'}</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#666173] dark:text-[#A7A2B8]">
              <span>Closed and preserved in Oopsie&apos;s conversation history.</span>
              <button
                type="button"
                onClick={handleReopenLoop}
                className="min-h-[44px] px-3.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA] font-medium hover:bg-white dark:hover:bg-[#1A1726]"
              >
                Reopen
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {item.status !== 'closed' && (
                <>
                  <button
                    type="button"
                    onClick={handleCloseLoop}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Mark done</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCustomPicker((v) => !v)}
                    className="min-h-[44px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#666173] dark:text-[#A7A2B8] hover:bg-[#EAE4FF]/50 dark:hover:bg-[#241F35]"
                  >
                    <Calendar className="w-4 h-4" />
                    <span>Reschedule</span>
                  </button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => onDeleteItem(item.id)}
              aria-label="Delete reminder"
              className="min-h-[44px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs text-[#666173] hover:text-rose-600 dark:hover:text-rose-400"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Delete</span>
            </button>
          </div>
        </div>
      </motion.aside>
    </div>
  );
}
