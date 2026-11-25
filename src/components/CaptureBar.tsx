import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Send, Plus, X, AlertCircle, CalendarClock } from 'lucide-react';
import type {
  AssistantMood,
  ChatExchangeMessage,
  ChatItemUpdate,
  ChatTurn,
  ParsedReminderDraft,
  ReminderCategory,
  ReminderItem,
  ReminderPriority,
  UserProfile,
} from '../types/reminder';
import { parseNaturalInput } from '../services/api';
import { adjustOutOfQuietHours } from '../services/time';
import { useFirebaseAuth } from '../contexts/FirebaseContext';
import { AssistantOrb } from './AssistantOrb';

interface CaptureBarProps {
  userProfile: UserProfile;
  items: ReminderItem[];
  onCreateItems: (drafts: ParsedReminderDraft[], rawUserMessage: string) => ReminderItem[];
  onApplyChatUpdate: (update: ChatItemUpdate, rawUserMessage: string) => ReminderItem | null;
  onOpenItem: (itemId: string) => void;
  onMoodChange: (mood: AssistantMood) => void;
  inputRef?: React.RefObject<HTMLTextAreaElement | null>;
  seedPrompt?: { text: string; key: number } | null;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
  isFinal: boolean;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

const EXAMPLE_PROMPTS = [
  "Remind me to follow up with Rahul about the quotation if he doesn't send it by Friday.",
  'Call Mom tonight at 8pm and pay electricity bill Friday morning',
  'Check with Priya every 2 days until the contract is signed',
];

export function CaptureBar({
  userProfile,
  items,
  onCreateItems,
  onApplyChatUpdate,
  onOpenItem,
  onMoodChange,
  inputRef,
  seedPrompt,
}: CaptureBarProps) {
  const { user, privacySettings } = useFirebaseAuth();
  const [text, setText] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [messages, setMessages] = useState<
    Array<ChatExchangeMessage & { citedIds?: string[]; lastFailedInput?: string }>
  >([]);
  const [activeThread, setActiveThread] = useState<ChatTurn[]>([]);
  const [topicBoundaryIndex, setTopicBoundaryIndex] = useState<number>(0);
  const [inlineDateTime, setInlineDateTime] = useState(() => {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [showManualForm, setShowManualForm] = useState(false);
  const [apiErrorBanner, setApiErrorBanner] = useState<string | null>(null);

  // Manual fallback state
  const [manualTitle, setManualTitle] = useState('');
  const [manualPerson, setManualPerson] = useState('');
  const [manualCategory, setManualCategory] = useState<ReminderCategory>('Personal');
  const [manualPriority, setManualPriority] = useState<ReminderPriority>('medium');
  const [manualDueLocal, setManualDueLocal] = useState(() => {
    const d = new Date(Date.now() + 3600000);
    d.setMinutes(0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [manualFollowUpDays, setManualFollowUpDays] = useState<string>('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const speechSupported =
    typeof window !== 'undefined' &&
    Boolean(
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
        (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    );

  useEffect(() => {
    if (seedPrompt?.text) {
      setText(seedPrompt.text);
      setActiveThread([]);
      setTopicBoundaryIndex(messages.length);
      window.setTimeout(() => inputRef?.current?.focus(), 120);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt?.key]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const toggleVoice = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      onMoodChange('idle');
      return;
    }

    const SpeechCtor =
      (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

    if (!SpeechCtor) return;

    const recognition = new SpeechCtor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setText(transcript);
    };

    recognition.onerror = () => {
      setIsListening(false);
      onMoodChange('idle');
    };

    recognition.onend = () => {
      setIsListening(false);
      onMoodChange('idle');
    };

    recognitionRef.current = recognition;
    setIsListening(true);
    onMoodChange('listening');
    recognition.start();
  };

  const handleSubmit = async (overrideText?: string) => {
    const trimmed = (overrideText ?? text).trim();
    if (!trimmed || isParsing) return;

    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    const sessionHistory: ChatTurn[] = messages
      .slice(topicBoundaryIndex)
      .filter((m) => !m.isError)
      .slice(-8)
      .map((m) => ({
        role: m.role,
        text: m.text,
      }));

    const userMsg: ChatExchangeMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text: trimmed,
      timestamp: new Date().toISOString(),
    };

    const overflow = Math.max(0, messages.length + 1 - 20);
    if (overflow > 0) {
      setTopicBoundaryIndex((idx) => Math.max(0, idx - overflow));
    }
    setMessages((prev) => [...prev, userMsg].slice(-20));
    setText('');

    if (!user) {
      setManualTitle(trimmed);
      setShowManualForm(true);
      setApiErrorBanner(
        'Sign in with Google to use AI natural-language parsing, or save directly using Quick fields below.'
      );
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'You are in local guest mode—sign in with Google for AI parsing, or save right away with the Quick fields form below.',
          timestamp: new Date().toISOString(),
          isError: true,
        },
      ]);
      onMoodChange('idle');
      return;
    }

    if (privacySettings?.aiAnalysisPaused) {
      setManualTitle(trimmed);
      setShowManualForm(true);
      setApiErrorBanner(
        'AI analysis is paused in your Privacy & Security Centre. Use Quick fields below or resume AI anytime.'
      );
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'AI analysis is currently paused in your Privacy & Security Centre. Save this reminder offline using Quick fields below.',
          timestamp: new Date().toISOString(),
          isError: true,
        },
      ]);
      onMoodChange('idle');
      return;
    }

    setIsParsing(true);
    setApiErrorBanner(null);
    onMoodChange('thinking');

    try {
      const result = await parseNaturalInput({
        input: trimmed,
        userProfile,
        existingItems: items,
        conversationHistory: sessionHistory,
      });

      if (result.action === 'clarify' || (result.needsClarification && result.clarifyingQuestion)) {
        const question = result.clarifyingQuestion || result.assistantReply;
        setActiveThread((prev) => [
          ...prev,
          { role: 'user', text: trimmed },
          { role: 'assistant', text: question },
        ]);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: question,
            timestamp: new Date().toISOString(),
            quickOptions: result.quickOptions || [],
            allowCustomDateTimePicker: Boolean(result.allowCustomDateTimePicker),
          },
        ]);
        onMoodChange('idle');
      } else if (result.action === 'update_item' && result.itemUpdate) {
        setActiveThread([]);
        const updatedItem = onApplyChatUpdate(result.itemUpdate, trimmed);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: result.assistantReply,
            timestamp: new Date().toISOString(),
            createdItems: updatedItem ? [updatedItem] : undefined,
          },
        ]);
        onMoodChange('happy');
        setTimeout(() => onMoodChange('idle'), 2000);
      } else if (result.action === 'answer_query' || result.action === 'chitchat') {
        setActiveThread([]);
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: result.assistantReply,
            timestamp: new Date().toISOString(),
            citedIds: result.citedItemIds || [],
          },
        ]);
        onMoodChange('idle');
      } else {
        const normalizedDrafts: ParsedReminderDraft[] = (result.items || []).map((draft) => ({
          ...draft,
          dueAtIso:
            draft.dueAtIso ||
            adjustOutOfQuietHours(new Date(Date.now() + 3600000).toISOString(), userProfile),
        }));

        if (normalizedDrafts.length === 0) {
          const followUp =
            result.clarifyingQuestion ||
            result.assistantReply ||
            "Tell me what you'd like Oopsie to remember and when (or tap Manual below) so I can save it right away.";
          setActiveThread((prev) => [
            ...prev,
            { role: 'user', text: trimmed },
            { role: 'assistant', text: followUp },
          ]);
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: 'assistant',
              text: followUp,
              timestamp: new Date().toISOString(),
              quickOptions: result.quickOptions || [],
              allowCustomDateTimePicker: Boolean(result.allowCustomDateTimePicker),
            },
          ]);
          onMoodChange('idle');
          return;
        }

        const threadSummary =
          activeThread.length > 0
            ? `${activeThread.filter((t) => t.role === 'user').map((t) => t.text).join(' · ')} · ${trimmed}`
            : trimmed;
        setActiveThread([]);
        setTopicBoundaryIndex(Math.min(20, messages.length + 2));

        const created = onCreateItems(normalizedDrafts, threadSummary);

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: result.assistantReply,
            timestamp: new Date().toISOString(),
            createdItems: created,
          },
        ]);
        onMoodChange(created.length > 0 ? 'happy' : 'idle');
        if (created.length > 0) {
          setTimeout(() => onMoodChange('idle'), 2200);
        }
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Something went wrong.';
      setApiErrorBanner(errMsg);
      setManualTitle(trimmed);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `Oopsie hit a quick snag reaching its parser (${errMsg}). Tap Retry below to keep going right here.`,
          timestamp: new Date().toISOString(),
          isError: true,
          lastFailedInput: trimmed,
        },
      ]);
      onMoodChange('idle');
    } finally {
      setIsParsing(false);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualTitle.trim()) return;
    const dueIso = manualDueLocal ? new Date(manualDueLocal).toISOString() : new Date(Date.now() + 3600000).toISOString();
    const interval = manualFollowUpDays ? Number(manualFollowUpDays) : null;

    const draft: ParsedReminderDraft = {
      title: manualTitle.trim(),
      person: manualPerson.trim() || null,
      project: null,
      category: manualCategory,
      priority: manualPriority,
      dueAtIso: dueIso,
      needsFollowUp: Boolean(interval || manualPerson.trim()),
      initialStatus: 'needs_action',
      followUpRule: {
        enabled: Boolean(interval && interval > 0),
        intervalDays: interval && interval > 0 ? interval : null,
        description: interval && interval > 0 ? `Check every ${interval} days until resolved` : null,
      },
    };

    const created = onCreateItems([draft], manualTitle.trim());
    setMessages((prev) => [
      ...prev.slice(-3),
      {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: `Saved "${draft.title}"—Oopsie will follow up with you on time.`,
        timestamp: new Date().toISOString(),
        createdItems: created,
      },
    ]);
    setManualTitle('');
    setManualPerson('');
    setManualFollowUpDays('');
    setShowManualForm(false);
    setApiErrorBanner(null);
    onMoodChange('happy');
    setTimeout(() => onMoodChange('idle'), 1800);
  };

  return (
    <section aria-label="Capture a reminder" className="space-y-3">
      <div className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] shadow-sm p-4 sm:p-5 transition-colors">
        <div className="flex items-start gap-3">
          <div className="hidden sm:block pt-1">
            <AssistantOrb mood={isListening ? 'listening' : isParsing ? 'thinking' : 'idle'} size="sm" />
          </div>
          <div className="flex-1 min-w-0">
            <textarea
              ref={inputRef}
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
              placeholder={
                activeThread.length > 0
                  ? 'Reply with day, time, or options...'
                  : `Tell Oopsie anything to follow up on, ${userProfile.name || 'friend'}...`
              }
              className="w-full resize-none bg-transparent text-[15px] sm:text-base text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E899E] dark:placeholder:text-[#7F7994] focus:outline-none leading-relaxed"
            />
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {speechSupported && (
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={isListening ? 'Stop listening' : 'Speak reminder'}
                className={`min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isListening
                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300'
                    : 'text-[#666173] dark:text-[#A7A2B8] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]'
                }`}
              >
                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                <span>{isListening ? 'Listening...' : 'Voice'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowManualForm((v) => !v)}
              className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-[#666173] dark:text-[#A7A2B8] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35] transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Quick fields</span>
            </button>
            {activeThread.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setActiveThread([]);
                  setTopicBoundaryIndex(messages.length);
                }}
                className="min-h-[44px] sm:min-h-[40px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA]"
              >
                <X className="w-3.5 h-3.5" />
                New topic
              </button>
            )}
          </div>

          <button
            type="button"
            disabled={!text.trim() || isParsing}
            onClick={() => handleSubmit()}
            className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] disabled:opacity-40 disabled:pointer-events-none text-white text-sm font-medium transition-colors whitespace-nowrap shrink-0 ml-auto"
          >
            <span>{isParsing ? 'Thinking...' : activeThread.length > 0 ? 'Reply' : 'Capture'}</span>
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Quick inspiration prompts when no active conversation */}
      {messages.length === 0 && !showManualForm && (
        <div className="flex flex-wrap items-center gap-2 px-1">
          <span className="text-xs text-[#666173] dark:text-[#A7A2B8]">Try:</span>
          {EXAMPLE_PROMPTS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setText(example)}
              className="text-left text-xs text-[#666173] dark:text-[#A7A2B8] hover:text-[#7657D5] dark:hover:text-[#B9A7F5] underline decoration-[#D5CFE6] dark:decoration-[#3A3352] underline-offset-4 transition-colors"
            >
              &quot;{example}&quot;
            </button>
          ))}
        </div>
      )}

      {/* Conversational capture feedback */}
      <AnimatePresence>
        {messages.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="rounded-2xl bg-[#EAE4FF]/45 dark:bg-[#1A1726]/90 border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
                Oopsie chat
              </span>
              <button
                type="button"
                onClick={() => {
                  setMessages([]);
                  setActiveThread([]);
                  setTopicBoundaryIndex(0);
                }}
                className="text-xs text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA]"
              >
                Clear
              </button>
            </div>
            <div className="space-y-2.5">
              {messages.map((msg, idx) => {
                const isLatest = idx === messages.length - 1;
                return (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[92%] sm:max-w-[86%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                        msg.role === 'user'
                          ? 'bg-[#7657D5] text-white'
                          : msg.isError
                            ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800/60'
                            : 'bg-white dark:bg-[#12101A] text-[#24212B] dark:text-[#F5F3FA] border border-[#E6E1F2] dark:border-[#2C2740]'
                      }`}
                    >
                      <p>{msg.text}</p>

                      {msg.lastFailedInput && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleSubmit(msg.lastFailedInput)}
                            className="min-h-[32px] px-3 py-1 rounded-lg bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-medium"
                          >
                            Retry message
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowManualForm(true)}
                            className="min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-medium text-amber-900 dark:text-amber-200 hover:underline"
                          >
                            Use quick fields
                          </button>
                        </div>
                      )}

                      {/* Quick options & inline date/time picker on the active assistant question */}
                      {isLatest && msg.role === 'assistant' && !isParsing && (
                        <>
                          {msg.quickOptions && msg.quickOptions.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {msg.quickOptions.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => handleSubmit(opt)}
                                  className="min-h-[36px] px-3 py-1.5 rounded-xl bg-[#EAE4FF]/70 hover:bg-[#EAE4FF] dark:bg-[#2B2444] dark:hover:bg-[#372E56] border border-[#D5CFE6] dark:border-[#3D3361] text-xs font-medium text-[#4C32A8] dark:text-[#EAE4FF] transition-colors"
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          )}

                          {msg.allowCustomDateTimePicker && (
                            <div className="mt-2.5 pt-2.5 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-wrap items-center gap-2">
                              <span className="inline-flex items-center gap-1 text-xs text-[#666173] dark:text-[#A7A2B8]">
                                <CalendarClock className="w-3.5 h-3.5" />
                                <span>Or pick exact day &amp; time:</span>
                              </span>
                              <input
                                type="datetime-local"
                                value={inlineDateTime}
                                onChange={(e) => setInlineDateTime(e.target.value)}
                                className="w-full sm:w-auto min-h-[44px] sm:min-h-[36px] px-2.5 rounded-lg bg-[#FAF9FC] dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-xs text-[#24212B] dark:text-[#F5F3FA]"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  if (!inlineDateTime) return;
                                  const formatted = new Date(inlineDateTime).toLocaleString('en-US', {
                                    weekday: 'short',
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                    hour: 'numeric',
                                    minute: '2-digit',
                                  });
                                  handleSubmit(formatted);
                                }}
                                className="min-h-[44px] sm:min-h-[36px] px-3 py-1 rounded-lg bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-medium whitespace-nowrap shrink-0"
                              >
                                Use this time
                              </button>
                            </div>
                          )}
                        </>
                      )}

                      {msg.createdItems && msg.createdItems.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-wrap gap-1.5 text-xs">
                          {msg.createdItems.map((ci) => (
                            <button
                              key={ci.id}
                              type="button"
                              onClick={() => onOpenItem(ci.id)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF9FC] dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA] hover:border-[#7657D5] transition-colors"
                            >
                              <span className="font-medium">{ci.title}</span>
                              {ci.person && <span className="text-[#8E899E]">· {ci.person}</span>}
                            </button>
                          ))}
                        </div>
                      )}

                      {msg.citedIds && msg.citedIds.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-[#EEEAF8] dark:border-[#2C2740] flex flex-wrap gap-1.5 text-xs">
                          {items
                            .filter((it) => msg.citedIds?.includes(it.id))
                            .map((ci) => (
                              <button
                                key={ci.id}
                                type="button"
                                onClick={() => onOpenItem(ci.id)}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FAF9FC] dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA] hover:border-[#7657D5] transition-colors"
                              >
                                <span className="font-medium">{ci.title}</span>
                                {ci.person && <span className="text-[#8E899E]">· {ci.person}</span>}
                              </button>
                            ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Graceful Manual Fallback Form */}
      <AnimatePresence>
        {showManualForm && (
          <motion.form
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            onSubmit={handleManualSubmit}
            className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                Quick reminder form
              </h3>
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="text-xs text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA]"
              >
                Close
              </button>
            </div>

            {apiErrorBanner && (
              <div className="flex items-start gap-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 p-3 text-xs text-amber-800 dark:text-amber-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{apiErrorBanner}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1">
                  What should Oopsie remember for you?
                </label>
                <input
                  type="text"
                  required
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="e.g., Follow up with Rahul about quotation"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1">
                  Person involved (optional)
                </label>
                <input
                  type="text"
                  value={manualPerson}
                  onChange={(e) => setManualPerson(e.target.value)}
                  placeholder="e.g., Rahul"
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1">
                  When
                </label>
                <input
                  type="datetime-local"
                  value={manualDueLocal}
                  onChange={(e) => setManualDueLocal(e.target.value)}
                  className="w-full h-11 px-3.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] font-mono text-sm focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1">
                  Category
                </label>
                <select
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as ReminderCategory)}
                  className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
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
                <label className="block text-xs font-medium text-[#666173] dark:text-[#A7A2B8] mb-1">
                  Priority &amp; recurring follow-up (days)
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={manualPriority}
                    onChange={(e) => setManualPriority(e.target.value as ReminderPriority)}
                    className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    max="90"
                    value={manualFollowUpDays}
                    onChange={(e) => setManualFollowUpDays(e.target.value)}
                    placeholder="Every X days"
                    className="w-full h-11 px-3 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#7657D5]/30"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowManualForm(false)}
                className="min-h-[44px] px-4 py-2 rounded-xl text-sm text-[#666173] dark:text-[#A7A2B8] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="min-h-[44px] px-5 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-sm font-medium"
              >
                Save reminder
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </section>
  );
}
