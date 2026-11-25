import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Brain, FolderKanban, Layers, RefreshCw, Search, Users } from 'lucide-react';
import type { BrainQueryResponse, ReminderItem, UserProfile } from '../types/reminder';
import { isClientAiAnalysisPaused, querySecondBrain } from '../services/api';
import { auth } from '../firebase';
import { formatDueLabel, formatTimelineTimestamp, getPersonInitials } from '../services/time';
import { AssistantOrb } from './AssistantOrb';
import { ReminderCard } from './ReminderCard';

interface BrainViewProps {
  items: ReminderItem[];
  userProfile: UserProfile;
  onComplete: (item: ReminderItem) => void;
  onSnoozeQuick: (item: ReminderItem) => void;
  onOpenTimeline: (item: ReminderItem) => void;
}

type GroupMode = 'status' | 'person' | 'project';

const SUGGESTED_QUESTIONS = [
  'What am I waiting on from others?',
  'What happened with the invoice?',
  'Show me everything overdue or needing action',
];

const STOP_WORDS = new Set([
  'what',
  'did',
  'does',
  'do',
  'told',
  'tell',
  'say',
  'said',
  'me',
  'my',
  'in',
  'to',
  'the',
  'a',
  'an',
  'of',
  'for',
  'with',
  'about',
  'on',
  'is',
  'are',
  'was',
  'were',
  'previous',
  'last',
  'latest',
  'update',
  'updates',
  'reminder',
  'reminders',
  'remember',
  'oopsie',
  'show',
  'everything',
  'from',
]);

function findLocalMemoryMatches(rawQuery: string, items: ReminderItem[]): ReminderItem[] {
  const tokens = rawQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));

  if (tokens.length === 0) return [];

  const scored = items
    .map((item) => {
      const haystack = [
        item.title,
        item.person || '',
        item.project || '',
        item.category,
        ...item.timeline.map((t) => t.text),
      ]
        .join(' ')
        .toLowerCase();

      let score = 0;
      for (const tok of tokens) {
        if (haystack.includes(tok)) {
          score += 3;
        } else if (tok.length >= 4) {
          // Fuzzy 4-char prefix match for minor name typos (e.g. keethu/keerthu)
          const prefix = tok.slice(0, 4);
          if (haystack.includes(prefix)) score += 1;
        }
      }
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 5).map((s) => s.item);
}

function getLatestHumanNote(item: ReminderItem) {
  const reversed = [...item.timeline].reverse();
  return (
    reversed.find((t) => t.type === 'user_update' || t.type === 'ai_summary') ||
    reversed.find((t) => t.type !== 'reminded') ||
    null
  );
}

export function BrainView({
  items,
  userProfile,
  onComplete,
  onSnoozeQuick,
  onOpenTimeline,
}: BrainViewProps) {
  const [query, setQuery] = useState('');
  const [lastAskedQuery, setLastAskedQuery] = useState('');
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<BrainQueryResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>('person');
  const [selectedPersonKey, setSelectedPersonKey] = useState<string | null>(null);
  const [searchFilter, setSearchFilter] = useState('');

  const handleAsk = async (q?: string) => {
    const finalQuery = (q ?? query).trim();
    if (!finalQuery || asking) return;
    setLastAskedQuery(finalQuery);
    setErrorMsg(null);
    setAnswer(null);

    if (items.length === 0) {
      setAnswer({
        answer:
          "You haven't saved any reminders with Oopsie yet—add one on the Today tab and I'll remember every detail and update here for you!",
        citedItemIds: [],
        suggestedAction: null,
      });
      return;
    }

    if (!auth.currentUser) {
      setErrorMsg('Sign in with Google for AI memory answers, or inspect the local keyword matches below.');
      return;
    }

    if (isClientAiAnalysisPaused()) {
      setErrorMsg('AI analysis is paused in Privacy & Security Centre. Showing local keyword matches below.');
      return;
    }

    setAsking(true);
    try {
      const res = await querySecondBrain({
        query: finalQuery,
        items,
        userProfile,
      });
      setAnswer(res);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const cleanMessage =
        raw.startsWith('{') || raw.includes('"error"')
          ? "Oopsie's smart search is briefly busy right now—tap Retry, or check the matching saved reminders below."
          : raw ||
            "Oopsie couldn't reach its smart search right now—check the matching reminders below.";
      setErrorMsg(cleanMessage);
    } finally {
      setAsking(false);
    }
  };

  const citedItems = useMemo(() => {
    if (!answer) return [];
    const set = new Set(answer.citedItemIds);
    return items.filter((i) => set.has(i.id));
  }, [answer, items]);

  const localMatches = useMemo(() => {
    if (!errorMsg || !lastAskedQuery) return [];
    return findLocalMemoryMatches(lastAskedQuery, items);
  }, [errorMsg, lastAskedQuery, items]);

  const filteredItems = useMemo(() => {
    const q = searchFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        (i.person && i.person.toLowerCase().includes(q)) ||
        (i.project && i.project.toLowerCase().includes(q)) ||
        i.timeline.some((t) => t.text.toLowerCase().includes(q))
    );
  }, [items, searchFilter]);

  // Dynamic list of all people found in the full items list with active reminder counts
  const peopleSummary = useMemo(() => {
    const map = new Map<
      string,
      { key: string; label: string; activeCount: number; totalCount: number }
    >();

    for (const item of items) {
      const raw = item.person?.trim() || '';
      const key = raw ? raw.toLowerCase() : '__just_me__';
      const label = raw
        ? raw.replace(/\b\w/g, (c) => c.toUpperCase())
        : 'Just me';
      const existing = map.get(key) || {
        key,
        label,
        activeCount: 0,
        totalCount: 0,
      };
      existing.totalCount += 1;
      if (item.status !== 'closed') {
        existing.activeCount += 1;
      }
      map.set(key, existing);
    }

    return Array.from(map.values()).sort((a, b) => {
      if (a.key === '__just_me__') return 1;
      if (b.key === '__just_me__') return -1;
      if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
      return a.label.localeCompare(b.label);
    });
  }, [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, { label: string; key: string; items: ReminderItem[] }>();

    if (groupMode === 'status') {
      map.set('Waiting on someone', { key: 'waiting', label: 'Waiting on someone', items: [] });
      map.set('Needs my action', { key: 'needs_action', label: 'Needs my action', items: [] });
      map.set('Closed', { key: 'closed', label: 'Closed', items: [] });
      for (const item of filteredItems) {
        const key =
          item.status === 'waiting'
            ? 'Waiting on someone'
            : item.status === 'closed'
              ? 'Closed'
              : 'Needs my action';
        map.get(key)!.items.push(item);
      }
    } else if (groupMode === 'person') {
      for (const item of filteredItems) {
        const raw = item.person?.trim() || '';
        const normKey = raw ? raw.toLowerCase() : '__just_me__';
        if (selectedPersonKey && normKey !== selectedPersonKey) continue;
        const label = raw
          ? raw.replace(/\b\w/g, (c) => c.toUpperCase())
          : 'Just me';
        if (!map.has(normKey)) {
          map.set(normKey, { key: normKey, label, items: [] });
        }
        map.get(normKey)!.items.push(item);
      }
    } else {
      for (const item of filteredItems) {
        const key = item.project?.trim() || item.category;
        if (!map.has(key)) map.set(key, { key, label: key, items: [] });
        map.get(key)!.items.push(item);
      }
    }

    const entries = Array.from(map.values())
      .filter((group) => group.items.length > 0)
      .map((group) => {
        const sortedItems = [...group.items].sort((a, b) => {
          const aClosed = a.status === 'closed' ? 1 : 0;
          const bClosed = b.status === 'closed' ? 1 : 0;
          if (aClosed !== bClosed) return aClosed - bClosed;
          return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
        });
        const activeCount = sortedItems.filter((i) => i.status !== 'closed').length;
        return {
          ...group,
          items: sortedItems,
          activeCount,
          totalCount: sortedItems.length,
        };
      });

    if (groupMode === 'person') {
      entries.sort((a, b) => {
        if (a.key === '__just_me__') return 1;
        if (b.key === '__just_me__') return -1;
        if (b.activeCount !== a.activeCount) return b.activeCount - a.activeCount;
        return a.label.localeCompare(b.label);
      });
    }

    return entries;
  }, [filteredItems, groupMode, selectedPersonKey]);

  return (
    <div className="space-y-8">
      {/* Second Brain Q&A Panel */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 space-y-4">
        <div className="flex items-start gap-3.5">
          <AssistantOrb mood={asking ? 'thinking' : 'idle'} size="sm" />
          <div>
            <h1 className="text-xl font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
              Conversations &amp; Memory
            </h1>
            <p className="text-sm text-[#666173] dark:text-[#A7A2B8]">
              Ask about any conversation, person, or previous update across everything Oopsie holds for you.
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAsk();
          }}
          className="flex flex-col sm:flex-row gap-2.5"
        >
          <div className="relative flex-1">
            <Brain className="w-4 h-4 text-[#8E889C] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g., What did Rahul say about the quotation?"
              className="w-full h-12 pl-10 pr-4 rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E889C] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30 focus:border-[#7657D5]"
            />
          </div>
          <button
            type="submit"
            disabled={!query.trim() || asking}
            className="min-h-[48px] px-5 rounded-2xl bg-[#7657D5] hover:bg-[#6445C5] disabled:opacity-40 text-white text-sm font-semibold whitespace-nowrap shrink-0 transition-colors"
          >
            {asking ? 'Searching memory...' : 'Ask Oopsie'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-[#8E889C]">Quick questions:</span>
          {SUGGESTED_QUESTIONS.map((sq) => (
            <button
              key={sq}
              type="button"
              onClick={() => {
                setQuery(sq);
                handleAsk(sq);
              }}
              className="text-[#666173] dark:text-[#A7A2B8] hover:text-[#7657D5] dark:hover:text-[#C5B4FF] underline decoration-[#DDD3FA] dark:decoration-[#3D3363] underline-offset-4"
            >
              {sq}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-amber-900 dark:text-amber-200">{errorMsg}</p>
              <button
                type="button"
                onClick={() => handleAsk(lastAskedQuery)}
                disabled={asking}
                className="min-h-[44px] sm:min-h-[34px] inline-flex items-center gap-1.5 px-3.5 py-1 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-xs font-medium whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry</span>
              </button>
            </div>

            {localMatches.length > 0 && (
              <div className="pt-2.5 border-t border-amber-200/70 dark:border-amber-900/50 space-y-2">
                <p className="text-xs font-medium text-amber-900 dark:text-amber-300">
                  Matching reminders &amp; updates from your saved memory:
                </p>
                <div className="space-y-2">
                  {localMatches.map((ci) => {
                    const latest = getLatestHumanNote(ci);
                    return (
                      <button
                        key={ci.id}
                        type="button"
                        onClick={() => onOpenTimeline(ci)}
                        className="w-full text-left rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-3 hover:border-[#7657D5] transition-colors space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                          <span className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                            {ci.title}
                            {ci.person ? ` · ${ci.person}` : ''}
                          </span>
                          <span className="text-[11px] text-[#8E889C] shrink-0">
                            {formatDueLabel(ci.dueAt)}
                          </span>
                        </div>
                        {latest && (
                          <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                            Latest note ({formatTimelineTimestamp(latest.timestamp)}): &quot;{latest.text}&quot;
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {answer && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A]/80 border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3"
          >
            <p className="text-sm text-[#24212B] dark:text-[#F5F3FA] leading-relaxed whitespace-pre-line">
              {answer.answer}
            </p>
            {answer.suggestedAction && (
              <p className="text-xs text-[#7657D5] dark:text-[#C5B4FF] font-medium">
                Suggested next step: {answer.suggestedAction}
              </p>
            )}
            {citedItems.length > 0 && (
              <div className="pt-2 border-t border-[#EFEBF7] dark:border-[#2C2740] space-y-2">
                <p className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                  From your saved threads:
                </p>
                <div className="space-y-2">
                  {citedItems.map((ci) => {
                    const latest = getLatestHumanNote(ci);
                    return (
                      <button
                        key={ci.id}
                        type="button"
                        onClick={() => onOpenTimeline(ci)}
                        className="w-full text-left px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5] transition-colors space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs">
                          <span className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                            {ci.title}
                            {ci.person ? ` · ${ci.person}` : ''}
                          </span>
                          <span className="text-[#8E889C] shrink-0">{formatDueLabel(ci.dueAt)}</span>
                        </div>
                        {latest && (
                          <p className="text-xs text-[#666173] dark:text-[#A7A2B8] truncate">
                            {latest.text}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </section>

      {/* Conversation Browser: Group by Person / Status / Project */}
      <section className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="inline-flex items-center p-1 rounded-xl bg-[#EAE4FF]/60 dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] self-start max-w-full overflow-x-auto">
            <button
              type="button"
              onClick={() => setGroupMode('person')}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                groupMode === 'person'
                  ? 'bg-white dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] shadow-sm'
                  : 'text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              <span>Person</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setGroupMode('status');
                setSelectedPersonKey(null);
              }}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                groupMode === 'status'
                  ? 'bg-white dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] shadow-sm'
                  : 'text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Status</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setGroupMode('project');
                setSelectedPersonKey(null);
              }}
              className={`min-h-[44px] sm:min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                groupMode === 'project'
                  ? 'bg-white dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] shadow-sm'
                  : 'text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
              }`}
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Project</span>
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-[#8E889C] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Filter conversations..."
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
            />
          </div>
        </div>

        {/* Dynamic People Summary Strip with active counts */}
        {groupMode === 'person' && peopleSummary.length > 0 && (
          <div className="flex gap-2.5 overflow-x-auto pb-1">
            {selectedPersonKey && (
              <button
                type="button"
                onClick={() => setSelectedPersonKey(null)}
                className="min-h-[42px] px-3.5 py-2 rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] hover:border-[#7657D5] text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF] whitespace-nowrap shrink-0 transition-colors"
              >
                Show all people
              </button>
            )}
            {peopleSummary.map((personEntry) => {
              const isSelected = selectedPersonKey === personEntry.key;
              return (
                <button
                  key={personEntry.key}
                  type="button"
                  onClick={() =>
                    setSelectedPersonKey((prev) =>
                      prev === personEntry.key ? null : personEntry.key
                    )
                  }
                  className={`min-h-[42px] inline-flex items-center gap-2.5 px-3.5 py-2 rounded-2xl border text-left transition-colors whitespace-nowrap shrink-0 ${
                    isSelected
                      ? 'bg-[#7657D5] text-white border-[#7657D5]'
                      : 'bg-white dark:bg-[#1A1726] border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5]/60 text-[#24212B] dark:text-[#F5F3FA]'
                  }`}
                >
                  <span
                    className={`w-6 h-6 rounded-full text-[11px] font-semibold flex items-center justify-center shrink-0 ${
                      isSelected
                        ? 'bg-white/20 text-white'
                        : 'bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF]'
                    }`}
                  >
                    {personEntry.key === '__just_me__'
                      ? 'Me'
                      : getPersonInitials(personEntry.label) || personEntry.label.slice(0, 1)}
                  </span>
                  <span className="text-xs font-semibold">{personEntry.label}</span>
                  <span
                    className={`text-[11px] font-mono tabular-nums ${
                      isSelected
                        ? 'text-white/85'
                        : 'text-[#666173] dark:text-[#A7A2B8]'
                    }`}
                  >
                    {personEntry.activeCount} active
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {grouped.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-[#DDD3FA] dark:border-[#3D3363] p-10 text-center text-sm text-[#666173] dark:text-[#A7A2B8]">
            No matching conversations yet. Add a reminder or log an update to start building your timeline!
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map((group) => (
              <div key={group.key} className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2.5">
                    {groupMode === 'person' && (
                      <span className="w-7 h-7 rounded-full bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] text-xs font-semibold flex items-center justify-center shrink-0">
                        {group.key === '__just_me__'
                          ? 'Me'
                          : getPersonInitials(group.label) || group.label.slice(0, 1)}
                      </span>
                    )}
                    <h3 className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                      {group.label}
                    </h3>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
                    {groupMode === 'person'
                      ? `${group.activeCount} active${
                          group.totalCount > group.activeCount
                            ? ` · ${group.totalCount} total`
                            : ''
                        }`
                      : group.key === 'closed'
                        ? `${group.totalCount} closed`
                        : `${group.activeCount} active${
                            group.totalCount > group.activeCount
                              ? ` · ${group.totalCount} total`
                              : ''
                          }`}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {group.items.map((item) => (
                    <ReminderCard
                      key={item.id}
                      item={item}
                      onComplete={onComplete}
                      onSnoozeQuick={onSnoozeQuick}
                      onOpenTimeline={onOpenTimeline}
                      allowInlineTimeline
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
