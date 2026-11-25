import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CalendarClock,
  Check,
  GitBranch,
  MessageSquare,
  Sparkles,
  User,
  X,
} from 'lucide-react';
import type {
  ParsedReminderDraft,
  ReminderCategory,
  ReminderItem,
  ReminderPriority,
  UserProfile,
} from '../types/reminder';
import { parseNaturalInput } from '../services/api';
import { adjustOutOfQuietHours } from '../services/time';
import { AssistantOrb } from './AssistantOrb';

interface AddReminderModalProps {
  userProfile: UserProfile;
  existingPeople: string[];
  existingItems: ReminderItem[];
  initialPerson?: string | null;
  initialDateIso?: string | null;
  initialPrompt?: string | null;
  onCreateItems: (drafts: ParsedReminderDraft[], rawNote: string) => void;
  onClose: () => void;
}

const QUICK_ADD_EXAMPLES = [
  'Remind me to follow up with Rahul about the quotation if he doesn\'t send it by Friday.',
  'Check with Priya Nair on design feedback tomorrow at 10am',
  'Call insurance office every 3 days until the claim is approved',
];

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function previewNaturalInput(raw: string): {
  person: string | null;
  action: string;
  dayLabel: string | null;
  isConditionBased: boolean;
  conditionText: string | null;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      person: null,
      action: '',
      dayLabel: null,
      isConditionBased: false,
      conditionText: null,
    };
  }

  const condMatch = trimmed.match(/\b(if\s+[^.!?]{4,90})/i);
  const personMatch = trimmed.match(
    /\b(?:with|to|ask|ping|call|email|from)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/
  );
  const dayMatch = trimmed.match(
    /\b(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next\s+\w+)\b/i
  );

  const action = trimmed
    .replace(/^(?:please\s+)?(?:remind\s+me\s+(?:to|about)?|follow\s+up\s+(?:with)?)\s*/i, '')
    .replace(/\b(if\s+[^.!?]+)$/i, '')
    .trim();

  return {
    person: personMatch ? personMatch[1] : null,
    action: action || trimmed,
    dayLabel: dayMatch ? dayMatch[1] : null,
    isConditionBased: Boolean(condMatch),
    conditionText: condMatch ? condMatch[1].trim() : null,
  };
}

function inferUpcomingFridayLocal(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (5 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(9, 30, 0, 0);
  return toLocalInputValue(d);
}

export function AddReminderModal({
  userProfile,
  existingPeople,
  existingItems,
  initialPerson,
  initialDateIso,
  initialPrompt,
  onCreateItems,
  onClose,
}: AddReminderModalProps) {
  const [mode, setMode] = useState<'conversational' | 'structured'>(
    initialPerson || initialDateIso ? 'structured' : 'conversational'
  );

  // Conversational Quick-Add state
  const [quickInput, setQuickInput] = useState(initialPrompt || '');
  const [parsingQuick, setParsingQuick] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);

  // Structured Form state
  const [title, setTitle] = useState('');
  const [contextNote, setContextNote] = useState('');
  const [person, setPerson] = useState(initialPerson || '');
  const [project, setProject] = useState('');
  const [category, setCategory] = useState<ReminderCategory>(
    initialPerson ? 'Work' : 'Personal'
  );
  const [priority, setPriority] = useState<ReminderPriority>('medium');
  const [dueLocal, setDueLocal] = useState(() => {
    if (initialDateIso) {
      const parsed = new Date(initialDateIso);
      if (!Number.isNaN(parsed.getTime())) return toLocalInputValue(parsed);
    }
    const d = new Date(Date.now() + 2 * 3600000);
    d.setMinutes(0, 0, 0);
    return toLocalInputValue(d);
  });
  const [notes, setNotes] = useState('');
  const [triggerType, setTriggerType] = useState<'time' | 'condition'>(
    initialPerson ? 'condition' : 'time'
  );
  const [conditionDesc, setConditionDesc] = useState('');
  const [intervalDays, setIntervalDays] = useState('');

  const livePreview = useMemo(() => previewNaturalInput(quickInput), [quickInput]);

  const applyParsedToStructured = (draft: ParsedReminderDraft, rawText: string) => {
    setTitle(draft.title);
    setPerson(draft.person || '');
    setProject(draft.project || '');
    setCategory(draft.category);
    setPriority(draft.priority);
    const dt = new Date(draft.dueAtIso);
    if (!Number.isNaN(dt.getTime())) {
      setDueLocal(toLocalInputValue(dt));
    }
    setTriggerType(draft.needsFollowUp || draft.followUpRule.enabled ? 'condition' : 'time');
    setConditionDesc(draft.followUpRule.description || '');
    setIntervalDays(draft.followUpRule.intervalDays ? String(draft.followUpRule.intervalDays) : '');
    setContextNote(rawText);
    setMode('structured');
  };

  const handleQuickParseAndSave = async (saveDirectly: boolean) => {
    const trimmed = quickInput.trim();
    if (!trimmed || parsingQuick) return;
    setParsingQuick(true);
    setQuickError(null);

    try {
      const res = await parseNaturalInput({
        input: trimmed,
        userProfile,
        existingItems,
      });

      if (res.items && res.items.length > 0) {
        const drafts = res.items.map((d) => ({
          ...d,
          dueAtIso: adjustOutOfQuietHours(d.dueAtIso, userProfile),
        }));
        if (saveDirectly) {
          onCreateItems(drafts, trimmed);
          onClose();
          return;
        }
        applyParsedToStructured(drafts[0], trimmed);
        return;
      }

      // If AI asks a clarification, smoothly pre-fill structured preview or use intelligent local fallback
      const fallbackDate = livePreview.dayLabel?.toLowerCase().includes('friday')
        ? new Date(inferUpcomingFridayLocal()).toISOString()
        : new Date(Date.now() + 24 * 3600000).toISOString();

      const fallbackDraft: ParsedReminderDraft = {
        title:
          livePreview.action.charAt(0).toUpperCase() + livePreview.action.slice(1) || trimmed,
        person: livePreview.person,
        project: null,
        category: livePreview.person ? 'Work' : 'Personal',
        priority: /\burgent|important|asap\b/i.test(trimmed) ? 'high' : 'medium',
        dueAtIso: adjustOutOfQuietHours(fallbackDate, userProfile),
        needsFollowUp: livePreview.isConditionBased || Boolean(livePreview.person),
        followUpRule: {
          enabled: livePreview.isConditionBased || Boolean(livePreview.person),
          intervalDays: null,
          description: livePreview.conditionText
            ? `Condition: ${livePreview.conditionText}`
            : livePreview.person
              ? `Follow up with ${livePreview.person}`
              : null,
        },
        initialStatus: livePreview.person ? 'waiting' : 'needs_action',
      };

      if (saveDirectly) {
        onCreateItems([fallbackDraft], trimmed);
        onClose();
      } else {
        applyParsedToStructured(fallbackDraft, trimmed);
      }
    } catch {
      const fallbackDate = livePreview.dayLabel?.toLowerCase().includes('friday')
        ? new Date(inferUpcomingFridayLocal()).toISOString()
        : new Date(Date.now() + 24 * 3600000).toISOString();

      const fallbackDraft: ParsedReminderDraft = {
        title:
          livePreview.action.charAt(0).toUpperCase() + livePreview.action.slice(1) || trimmed,
        person: livePreview.person,
        project: null,
        category: livePreview.person ? 'Work' : 'Personal',
        priority: 'medium',
        dueAtIso: adjustOutOfQuietHours(fallbackDate, userProfile),
        needsFollowUp: livePreview.isConditionBased || Boolean(livePreview.person),
        followUpRule: {
          enabled: livePreview.isConditionBased || Boolean(livePreview.person),
          intervalDays: null,
          description: livePreview.conditionText
            ? `Condition: ${livePreview.conditionText}`
            : null,
        },
        initialStatus: livePreview.person ? 'waiting' : 'needs_action',
      };

      if (saveDirectly) {
        onCreateItems([fallbackDraft], trimmed);
        onClose();
      } else {
        applyParsedToStructured(fallbackDraft, trimmed);
      }
    } finally {
      setParsingQuick(false);
    }
  };

  const handleStructuredSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    const cleanPerson = person.trim() || null;
    const dueIso = dueLocal
      ? new Date(dueLocal).toISOString()
      : new Date(Date.now() + 3600000).toISOString();
    const daysNum = Number(intervalDays);
    const hasInterval = !Number.isNaN(daysNum) && daysNum > 0;
    const isCondition = triggerType === 'condition';

    const ruleDescription = isCondition
      ? conditionDesc.trim() ||
        (cleanPerson
          ? `Condition: Follow up if ${cleanPerson} hasn't responded`
          : 'Condition-based follow-up check')
      : hasInterval
        ? `Check every ${daysNum} day${daysNum === 1 ? '' : 's'}`
        : null;

    const draft: ParsedReminderDraft = {
      title: title.trim(),
      person: cleanPerson,
      project: project.trim() || null,
      category,
      priority,
      dueAtIso: dueIso,
      needsFollowUp: isCondition || hasInterval || Boolean(cleanPerson),
      followUpRule: {
        enabled: isCondition || hasInterval || Boolean(cleanPerson),
        intervalDays: hasInterval ? daysNum : null,
        description: ruleDescription,
      },
      initialStatus: isCondition || cleanPerson ? 'waiting' : 'needs_action',
    };

    const noteParts = [contextNote.trim(), notes.trim()].filter(Boolean);
    const rawSummary =
      noteParts.length > 0 ? noteParts.join(' — ') : title.trim();

    onCreateItems([draft], rawSummary);
    onClose();
  };

  const setPresetHours = (hours: number) => {
    const d = new Date(Date.now() + hours * 3600000);
    d.setMinutes(0, 0, 0);
    setDueLocal(toLocalInputValue(d));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#24212B]/55 backdrop-blur-sm sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-reminder-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="w-full sm:max-w-xl rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] shadow-2xl overflow-hidden max-h-[92dvh] flex flex-col"
      >
        {/* Drag handle on mobile */}
        <div className="sm:hidden pt-3 flex justify-center">
          <span className="w-10 h-1.5 rounded-full bg-[#E6E1F2] dark:bg-[#2C2740]" />
        </div>

        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-[#EFEBF7] dark:border-[#2C2740] flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <AssistantOrb mood={parsingQuick ? 'thinking' : 'idle'} size="sm" />
            <div className="min-w-0">
              <h2
                id="add-reminder-title"
                className="text-base sm:text-lg font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]"
              >
                New follow-up reminder
              </h2>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Type naturally or fill in conversation details
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close new reminder dialog"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#2B2444] shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-5 sm:px-6 pt-4">
          <div className="grid grid-cols-2 p-1 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#EFEBF7] dark:border-[#2C2740]">
            <button
              type="button"
              onClick={() => setMode('conversational')}
              className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'conversational'
                  ? 'bg-white dark:bg-[#241F35] text-[#7657D5] dark:text-[#C5B4FF] shadow-sm'
                  : 'text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Quick-Add Chat</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('structured')}
              className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                mode === 'structured'
                  ? 'bg-white dark:bg-[#241F35] text-[#7657D5] dark:text-[#C5B4FF] shadow-sm'
                  : 'text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
              }`}
            >
              <CalendarClock className="w-3.5 h-3.5" />
              <span>Detailed Form</span>
            </button>
          </div>
        </div>

        <div className="p-5 sm:p-6 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pb-6 overflow-y-auto space-y-5">
          {mode === 'conversational' ? (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="quick-add-textarea"
                  className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-2"
                >
                  What conversation or commitment should Oopsie track?
                </label>
                <textarea
                  id="quick-add-textarea"
                  rows={3}
                  autoFocus={typeof window !== 'undefined' && window.innerWidth >= 640}
                  value={quickInput}
                  onChange={(e) => setQuickInput(e.target.value)}
                  placeholder="Remind me to follow up with Rahul about the quotation if he doesn't send it by Friday."
                  className="w-full rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] px-4 py-3 text-sm text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E889C] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30 focus:border-[#7657D5] resize-none"
                />
              </div>

              {/* Intelligent Detection Preview */}
              {quickInput.trim() && (
                <div className="rounded-2xl bg-[#EAE4FF]/45 dark:bg-[#2B2444]/60 border border-[#DDD3FA] dark:border-[#3D3363] p-4 space-y-2">
                  <p className="text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF]">
                    Oopsie detected
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-[#24212B] dark:text-[#F5F3FA]">
                    <div>
                      <span className="text-[#666173] dark:text-[#A7A2B8]">Action: </span>
                      <span className="font-medium">{livePreview.action}</span>
                    </div>
                    <div>
                      <span className="text-[#666173] dark:text-[#A7A2B8]">Person: </span>
                      <span className="font-medium">{livePreview.person || 'Just you'}</span>
                    </div>
                    <div>
                      <span className="text-[#666173] dark:text-[#A7A2B8]">Timing: </span>
                      <span className="font-medium font-mono">
                        {livePreview.dayLabel || 'Next smart slot'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[#666173] dark:text-[#A7A2B8]">Trigger: </span>
                      <span className="font-medium">
                        {livePreview.isConditionBased
                          ? livePreview.conditionText
                          : 'Time-based reminder'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Quick Examples */}
              <div className="space-y-1.5">
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">Try an example:</p>
                <div className="space-y-1.5">
                  {QUICK_ADD_EXAMPLES.map((ex) => (
                    <button
                      key={ex}
                      type="button"
                      onClick={() => setQuickInput(ex)}
                      className="w-full text-left text-xs text-[#666173] dark:text-[#A7A2B8] hover:text-[#7657D5] dark:hover:text-[#C5B4FF] px-3 py-2 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-transparent hover:border-[#DDD3FA] dark:hover:border-[#3D3363] transition-colors"
                    >
                      &quot;{ex}&quot;
                    </button>
                  ))}
                </div>
              </div>

              {quickError && (
                <p className="text-xs text-[#D9534F]">{quickError}</p>
              )}

              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={!quickInput.trim() || parsingQuick}
                  onClick={() => void handleQuickParseAndSave(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#2B2444] disabled:opacity-40 transition-colors"
                >
                  Review &amp; customize fields
                </button>
                <button
                  type="button"
                  disabled={!quickInput.trim() || parsingQuick}
                  onClick={() => void handleQuickParseAndSave(true)}
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] disabled:opacity-40 text-white text-sm font-semibold transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>{parsingQuick ? 'Understanding...' : 'Save reminder'}</span>
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleStructuredSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                  Reminder title
                </label>
                <input
                  type="text"
                  required
                  autoFocus={typeof window !== 'undefined' && window.innerWidth >= 640}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g., Follow up with Rahul about the Q4 quotation"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30 focus:border-[#7657D5]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                  Conversation or context
                </label>
                <textarea
                  rows={2}
                  value={contextNote}
                  onChange={(e) => setContextNote(e.target.value)}
                  placeholder="What was agreed or discussed last time?"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30 resize-none"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                    Person or contact
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-[#8E889C] absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      list="oopsie-people-list"
                      value={person}
                      onChange={(e) => setPerson(e.target.value)}
                      placeholder="e.g., Rahul"
                      className="w-full h-11 pl-9 pr-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                    />
                    <datalist id="oopsie-people-list">
                      {existingPeople.map((p) => (
                        <option key={p} value={p} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                    Project or topic (optional)
                  </label>
                  <input
                    type="text"
                    value={project}
                    onChange={(e) => setProject(e.target.value)}
                    placeholder="e.g., Q4 Renewal"
                    className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as ReminderCategory)}
                    className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA]"
                  >
                    <option value="Work">Work</option>
                    <option value="Personal">Personal</option>
                    <option value="Finance">Finance</option>
                    <option value="Health">Health</option>
                    <option value="Errands">Errands</option>
                    <option value="Social">Social</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                    Priority
                  </label>
                  <select
                    value={priority}
                    onChange={(e) => setPriority(e.target.value as ReminderPriority)}
                    className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA]"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
              </div>

              <div>
                <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                  <label className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                    Date &amp; time
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setPresetHours(3)}
                      className="min-h-[36px] px-2 text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
                    >
                      In 3h
                    </button>
                    <span className="text-[#CBC4DA]">·</span>
                    <button
                      type="button"
                      onClick={() => setPresetHours(24)}
                      className="min-h-[36px] px-2 text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
                    >
                      Tomorrow
                    </button>
                    <span className="text-[#CBC4DA]">·</span>
                    <button
                      type="button"
                      onClick={() => setDueLocal(inferUpcomingFridayLocal())}
                      className="min-h-[36px] px-2 text-[#7657D5] dark:text-[#C5B4FF] hover:underline"
                    >
                      Friday AM
                    </button>
                  </div>
                </div>
                <input
                  type="datetime-local"
                  required
                  value={dueLocal}
                  onChange={(e) => setDueLocal(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-xs text-[#24212B] dark:text-[#F5F3FA]"
                />
              </div>

              {/* Time-based vs Condition-based Trigger */}
              <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 space-y-3">
                <span className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                  Follow-up trigger type
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setTriggerType('time')}
                    className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                      triggerType === 'time'
                        ? 'border-[#7657D5] bg-[#EAE4FF]/70 dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF]'
                        : 'border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-[#666173] dark:text-[#A7A2B8]'
                    }`}
                  >
                    <CalendarClock className="w-3.5 h-3.5" />
                    <span>Time-based</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTriggerType('condition')}
                    className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                      triggerType === 'condition'
                        ? 'border-[#7657D5] bg-[#EAE4FF]/70 dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF]'
                        : 'border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] text-[#666173] dark:text-[#A7A2B8]'
                    }`}
                  >
                    <GitBranch className="w-3.5 h-3.5" />
                    <span>Condition-based</span>
                  </button>
                </div>

                {triggerType === 'condition' ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      value={conditionDesc}
                      onChange={(e) => setConditionDesc(e.target.value)}
                      placeholder="e.g., If Rahul hasn't sent the quotation by Friday"
                      className="w-full h-11 px-3 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-xs text-[#24212B] dark:text-[#F5F3FA]"
                    />
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#666173] dark:text-[#A7A2B8]">
                      <span>Auto-check every</span>
                      <input
                        type="number"
                        min="0"
                        max="60"
                        value={intervalDays}
                        onChange={(e) => setIntervalDays(e.target.value)}
                        placeholder="2"
                        className="w-16 h-9 px-2 rounded-lg bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-center text-[#24212B] dark:text-[#F5F3FA]"
                      />
                      <span>days if still pending</span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#666173] dark:text-[#A7A2B8]">
                    <span>Optional repeat interval: every</span>
                    <input
                      type="number"
                      min="0"
                      max="60"
                      value={intervalDays}
                      onChange={(e) => setIntervalDays(e.target.value)}
                      placeholder="0"
                      className="w-16 h-9 px-2 rounded-lg bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-center text-[#24212B] dark:text-[#F5F3FA]"
                    />
                    <span>days (leave blank for one-time)</span>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] mb-1.5">
                  Additional notes (optional)
                </label>
                <div className="relative">
                  <MessageSquare className="w-4 h-4 text-[#8E889C] absolute left-3 top-3.5" />
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Any extra link, quote amount, or detail to keep handy"
                    className="w-full h-11 pl-9 pr-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm text-[#24212B] dark:text-[#F5F3FA]"
                  />
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-sm font-medium text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#7657D5] hover:bg-[#6445C5] text-white text-sm font-semibold transition-colors"
                >
                  <Check className="w-4 h-4" />
                  <span>Save reminder</span>
                </button>
              </div>
            </form>
          )}
        </div>
      </motion.div>
    </div>
  );
}
