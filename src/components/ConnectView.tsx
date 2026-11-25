import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  FileAudio,
  FileText,
  History,
  Instagram,
  Link2,
  Loader2,
  Mail,
  MessageCircle,
  Mic,
  PhoneCall,
  RefreshCw,
  Send,
  Share2,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Unlink,
  Upload,
  UserCheck,
  X,
} from 'lucide-react';
import type {
  CalendarEventSummary,
  ConnectImportMethod,
  ConnectIntegrationState,
  ConnectPlatformId,
  ContactProfile,
  ConversationAnalysisResult,
  DetectedResponseCandidate,
  GmailMessageSummary,
  ImportedConversationRecord,
  ParsedReminderDraft,
  ReminderCategory,
  ReminderItem,
  ReminderPriority,
  UserProfile,
} from '../types/reminder';
import { useFirebaseAuth } from '../contexts/FirebaseContext';
import {
  analyzeConnectConversation,
  detectConnectResponses,
  transcribeConnectAudio,
  validateConnectUploadFile,
} from '../services/api';
import {
  CONNECT_PLATFORMS,
  fetchGmailMessages,
  fetchGoogleCalendarEvents,
  findContactMatches,
  findDuplicateReminders,
  getDefaultIntegrationsMap,
  loadEncryptedConversations,
  loadEncryptedDetectedResponses,
  loadIntegrationsMap,
  parseExportedConversationFile,
  purgeAllConnectData,
  saveEncryptedConversations,
  saveEncryptedDetectedResponses,
  saveIntegrationsMap,
} from '../services/connect';
import { formatDueLabel, formatTimelineTimestamp } from '../services/time';
import { ConfirmDialog } from './ConfirmDialog';

interface ConnectViewProps {
  items: ReminderItem[];
  contactsMap: Record<string, ContactProfile>;
  existingPeople: string[];
  userProfile: UserProfile;
  initialSharedText?: { title?: string; text?: string; url?: string; key: number } | null;
  onCreateItems: (drafts: ParsedReminderDraft[], rawUserMessage: string) => ReminderItem[];
  onUpdateItem: (updated: ReminderItem, closedJustNow?: boolean) => void;
  onSaveContact: (contact: ContactProfile) => void;
  onOpenTimeline: (item: ReminderItem) => void;
  onOpenWhatHappened: (item: ReminderItem) => void;
  onNotifyToast: (msg: string) => void;
  onCandidateCountChange?: (count: number) => void;
}

const CATEGORIES: ReminderCategory[] = [
  'Work',
  'Personal',
  'Finance',
  'Health',
  'Errands',
  'Social',
];

const PLATFORM_META_STYLES: Record<
  ConnectPlatformId,
  {
    icon: typeof Mail;
    iconBg: string;
    iconColor: string;
  }
> = {
  gmail: {
    icon: Mail,
    iconBg: 'bg-rose-50 dark:bg-rose-950/40',
    iconColor: 'text-rose-600 dark:text-rose-400',
  },
  google_calendar: {
    icon: Calendar,
    iconBg: 'bg-sky-50 dark:bg-sky-950/40',
    iconColor: 'text-sky-600 dark:text-sky-400',
  },
  whatsapp: {
    icon: MessageCircle,
    iconBg: 'bg-emerald-50 dark:bg-emerald-950/40',
    iconColor: 'text-emerald-600 dark:text-emerald-400',
  },
  phone: {
    icon: PhoneCall,
    iconBg: 'bg-[#EAE4FF] dark:bg-[#2B2444]',
    iconColor: 'text-[#7657D5] dark:text-[#C5B4FF]',
  },
  instagram: {
    icon: Instagram,
    iconBg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40',
    iconColor: 'text-fuchsia-600 dark:text-fuchsia-400',
  },
  telegram: {
    icon: Send,
    iconBg: 'bg-cyan-50 dark:bg-cyan-950/40',
    iconColor: 'text-cyan-600 dark:text-cyan-400',
  },
};

function toLocalDateTimeInputValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',').pop() || '' : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Could not read audio data.'));
    reader.readAsDataURL(blob);
  });
}

export function ConnectView({
  items,
  contactsMap,
  existingPeople,
  userProfile,
  initialSharedText,
  onCreateItems,
  onUpdateItem,
  onSaveContact,
  onOpenTimeline,
  onOpenWhatHappened,
  onNotifyToast,
  onCandidateCountChange,
}: ConnectViewProps) {
  const {
    user,
    privacySettings,
    workspaceToken,
    workspaceEmail,
    isConnectingWorkspace,
    workspaceAuthError,
    connectGoogleWorkspace,
    disconnectGoogleWorkspace,
    clearWorkspaceAuthError,
  } = useFirebaseAuth();

  const [integrations, setIntegrations] = useState<
    Record<ConnectPlatformId, ConnectIntegrationState>
  >(() => loadIntegrationsMap());
  const [conversations, setConversations] = useState<ImportedConversationRecord[]>([]);
  const [vaultLoaded, setVaultLoaded] = useState(false);
  const [detectedResponses, setDetectedResponses] = useState<DetectedResponseCandidate[]>([]);

  // Active Import Studio state
  const [selectedPlatform, setSelectedPlatform] = useState<ConnectPlatformId>('whatsapp');
  const [selectedMethod, setSelectedMethod] = useState<ConnectImportMethod>('text');
  const [rawInputText, setRawInputText] = useState('');
  const [importSourceNote, setImportSourceNote] = useState<string | null>(null);
  const [externalSourceId, setExternalSourceId] = useState<string | null>(null);

  // Voice Recorder state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<number | null>(null);

  // Google Workspace Live Feeds
  const [gmailMessages, setGmailMessages] = useState<GmailMessageSummary[]>([]);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventSummary[]>([]);
  const [isFetchingGoogle, setIsFetchingGoogle] = useState(false);
  const [isScanningReplies, setIsScanningReplies] = useState(false);
  const [workspaceFetchError, setWorkspaceFetchError] = useState<string | null>(null);

  // Consent Modal & Confirmations
  const [pendingConsentPlatform, setPendingConsentPlatform] = useState<
    'gmail' | 'google_calendar' | null
  >(null);
  const [pendingDisconnectPlatform, setPendingDisconnectPlatform] = useState<
    'gmail' | 'google_calendar' | null
  >(null);
  const [pendingDeleteConvoId, setPendingDeleteConvoId] = useState<string | null>(null);
  const [pendingPurgeAll, setPendingPurgeAll] = useState(false);

  // AI Analysis & Editable Review state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ConversationAnalysisResult | null>(null);
  const [clarificationAnswer, setClarificationAnswer] = useState('');

  // Editable Follow-up Draft fields
  const [draftTitle, setDraftTitle] = useState('');
  const [draftPerson, setDraftPerson] = useState('');
  const [selectedExistingPersonKey, setSelectedExistingPersonKey] = useState<string>('custom');
  const [draftCategory, setDraftCategory] = useState<ReminderCategory>('Work');
  const [draftPriority, setDraftPriority] = useState<ReminderPriority>('medium');
  const [draftStatus, setDraftStatus] = useState<'waiting' | 'needs_action'>('waiting');
  const [draftDueLocal, setDraftDueLocal] = useState('');
  const [draftCommitment, setDraftCommitment] = useState('');
  const [draftRule, setDraftRule] = useState('');
  const [targetDuplicateId, setTargetDuplicateId] = useState<string | null>(null);

  const importStudioRef = useRef<HTMLElement | null>(null);
  const textFileInputRef = useRef<HTMLInputElement | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);

  // Load encrypted vault on mount
  useEffect(() => {
    let mounted = true;
    void Promise.all([
      loadEncryptedConversations(),
      loadEncryptedDetectedResponses(),
    ]).then(([convos, responses]) => {
      if (!mounted) return;
      setConversations(convos);
      setDetectedResponses(responses);
      setVaultLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Persist integrations metadata
  useEffect(() => {
    saveIntegrationsMap(integrations);
  }, [integrations]);

  // Persist encrypted conversations once loaded
  useEffect(() => {
    if (!vaultLoaded) return;
    void saveEncryptedConversations(conversations).catch(() => {
      // Ignore storage failures silently
    });
  }, [conversations, vaultLoaded]);

  useEffect(() => {
    if (!vaultLoaded) return;
    void saveEncryptedDetectedResponses(detectedResponses).catch(() => {
      // Ignore
    });
    onCandidateCountChange?.(detectedResponses.length);
  }, [detectedResponses, vaultLoaded, onCandidateCountChange]);

  // Reflect incoming Web Share Target content
  useEffect(() => {
    if (!initialSharedText) return;
    const combined = [
      initialSharedText.title ? `Title: ${initialSharedText.title}` : '',
      initialSharedText.text || '',
      initialSharedText.url ? `Link: ${initialSharedText.url}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    if (combined.trim()) {
      setSelectedPlatform('whatsapp');
      setSelectedMethod('share');
      setRawInputText(combined);
      setImportSourceNote('Received from mobile Share sheet');
      setAnalysis(null);
    }
  }, [initialSharedText]);

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) window.clearInterval(recordTimerRef.current);
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const populateReviewFromAnalysis = useCallback(
    (result: ConversationAnalysisResult) => {
      const contactMatches = findContactMatches(
        result.suggestedFollowUp.person || result.person,
        contactsMap,
        items
      );
      const duplicateMatches = findDuplicateReminders(
        result.suggestedFollowUp.person || result.person,
        result.suggestedFollowUp.title || result.topic,
        items
      );

      const enriched: ConversationAnalysisResult = {
        ...result,
        personMatchCandidates: contactMatches,
        duplicateReminderMatches: duplicateMatches,
      };

      setAnalysis(enriched);
      setDraftTitle(result.suggestedFollowUp.title || result.topic || 'Follow-up');

      const exactMatch = contactMatches.find((c) => c.reason === 'Exact contact match');
      if (exactMatch) {
        setSelectedExistingPersonKey(exactMatch.key);
        setDraftPerson(exactMatch.name);
      } else {
        setSelectedExistingPersonKey('custom');
        setDraftPerson(result.suggestedFollowUp.person || result.person || '');
      }

      setDraftCategory(result.suggestedFollowUp.category || 'Work');
      setDraftPriority(result.suggestedFollowUp.priority || 'medium');
      setDraftStatus(result.suggestedFollowUp.status || 'waiting');
      setDraftDueLocal(toLocalDateTimeInputValue(result.suggestedFollowUp.dueAtIso));
      setDraftCommitment(result.suggestedFollowUp.commitmentSummary || '');
      setDraftRule(result.suggestedFollowUp.ruleDescription || '');
      setTargetDuplicateId(null);
      setClarificationAnswer('');
    },
    [contactsMap, items]
  );

  const runAnalysis = async (
    textToAnalyze: string,
    platform = selectedPlatform,
    method = selectedMethod,
    extId = externalSourceId
  ) => {
    const trimmed = textToAnalyze.trim();
    if (!trimmed) {
      setAnalysisError('Please paste, record, upload, or select a conversation first.');
      return;
    }
    if (!user) {
      setAnalysisError('Sign in with Google to run AI conversation analysis.');
      return;
    }
    if (privacySettings?.aiAnalysisPaused) {
      setAnalysisError(
        'AI analysis is currently paused in your Privacy & Security Centre. Resume it there to analyze conversations.'
      );
      return;
    }
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const result = await analyzeConnectConversation({
        rawText: trimmed,
        platform,
        method,
        userProfile,
        existingPeople,
        existingItems: items,
      });
      setExternalSourceId(extId);
      populateReviewFromAnalysis(result);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Oopsie could not analyze that conversation.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Sync Gmail threads
  const handleSyncGmail = async (tokenOverride?: string, emailOverride?: string | null) => {
    if (privacySettings?.gmailSyncPaused) {
      setWorkspaceFetchError(
        'Gmail sync is paused in Privacy & Security Centre. Resume Gmail sync there to refresh threads.'
      );
      return;
    }
    const token = tokenOverride || workspaceToken;
    if (!token) {
      setPendingConsentPlatform('gmail');
      return;
    }
    setIsFetchingGoogle(true);
    setWorkspaceFetchError(null);
    try {
      const messages = await fetchGmailMessages(token, 12);
      setGmailMessages(messages);
      const nowIso = new Date().toISOString();
      setIntegrations((prev) => ({
        ...prev,
        gmail: {
          ...prev.gmail,
          connected: true,
          connectedEmail: emailOverride ?? workspaceEmail ?? prev.gmail.connectedEmail,
          lastSyncedAt: nowIso,
          permissionGrantedAt: prev.gmail.permissionGrantedAt || nowIso,
        },
      }));
      setSelectedPlatform('gmail');
      setSelectedMethod('gmail_api');
      onNotifyToast(`Loaded ${messages.length} recent Gmail messages.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not fetch Gmail messages.';
      if (msg === 'GMAIL_AUTH_EXPIRED') {
        disconnectGoogleWorkspace();
        setWorkspaceFetchError(
          'Your Gmail session expired. Please tap Reconnect Gmail to continue.'
        );
      } else {
        setWorkspaceFetchError(msg);
      }
    } finally {
      setIsFetchingGoogle(false);
    }
  };

  // Sync Google Calendar meetings
  const handleSyncCalendar = async (tokenOverride?: string, emailOverride?: string | null) => {
    if (privacySettings?.calendarSyncPaused) {
      setWorkspaceFetchError(
        'Google Calendar sync is paused in Privacy & Security Centre. Resume it there to sync meetings.'
      );
      return;
    }
    const token = tokenOverride || workspaceToken;
    if (!token) {
      setPendingConsentPlatform('google_calendar');
      return;
    }
    setIsFetchingGoogle(true);
    setWorkspaceFetchError(null);
    try {
      const events = await fetchGoogleCalendarEvents(token, 15);
      setCalendarEvents(events);
      const nowIso = new Date().toISOString();
      setIntegrations((prev) => ({
        ...prev,
        google_calendar: {
          ...prev.google_calendar,
          connected: true,
          connectedEmail:
            emailOverride ?? workspaceEmail ?? prev.google_calendar.connectedEmail,
          lastSyncedAt: nowIso,
          permissionGrantedAt: prev.google_calendar.permissionGrantedAt || nowIso,
        },
      }));
      setSelectedPlatform('google_calendar');
      setSelectedMethod('calendar_api');
      onNotifyToast(`Loaded ${events.length} Google Calendar meetings.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not fetch Calendar events.';
      if (msg === 'CALENDAR_AUTH_EXPIRED') {
        disconnectGoogleWorkspace();
        setWorkspaceFetchError(
          'Your Google Calendar session expired. Please tap Reconnect Calendar to continue.'
        );
      } else {
        setWorkspaceFetchError(msg);
      }
    } finally {
      setIsFetchingGoogle(false);
    }
  };

  // Explicit permission grant flow
  const handleConfirmWorkspaceConsent = async () => {
    const target = pendingConsentPlatform;
    setPendingConsentPlatform(null);
    if (!target) return;

    clearWorkspaceAuthError();
    const res = await connectGoogleWorkspace();
    if (!res) return;

    const nowIso = new Date().toISOString();
    setIntegrations((prev) => ({
      ...prev,
      gmail: {
        ...prev.gmail,
        connected: true,
        connectedEmail: res.email,
        permissionGrantedAt: nowIso,
      },
      google_calendar: {
        ...prev.google_calendar,
        connected: true,
        connectedEmail: res.email,
        permissionGrantedAt: nowIso,
      },
    }));

    if (target === 'gmail') {
      await handleSyncGmail(res.accessToken, res.email);
    } else {
      await handleSyncCalendar(res.accessToken, res.email);
    }
  };

  // Response tracking for Gmail
  const handleScanIncomingReplies = async () => {
    if (privacySettings?.gmailSyncPaused) {
      setWorkspaceFetchError(
        'Gmail sync is paused in Privacy & Security Centre. Resume Gmail sync there to scan replies.'
      );
      return;
    }
    if (privacySettings?.aiAnalysisPaused) {
      setWorkspaceFetchError(
        'AI analysis is paused in Privacy & Security Centre. Resume it there to scan incoming email replies.'
      );
      return;
    }
    let token = workspaceToken;
    if (!token) {
      setPendingConsentPlatform('gmail');
      return;
    }
    setIsScanningReplies(true);
    setWorkspaceFetchError(null);
    try {
      const messages = gmailMessages.length > 0 ? gmailMessages : await fetchGmailMessages(token, 12);
      setGmailMessages(messages);
      const { candidates } = await detectConnectResponses({
        messages,
        activeItems: items,
        userProfile,
      });

      const nowIso = new Date().toISOString();
      setIntegrations((prev) => ({
        ...prev,
        gmail: { ...prev.gmail, lastSyncedAt: nowIso },
      }));

      setDetectedResponses(candidates);
      if (candidates.length === 0) {
        onNotifyToast('Scanned recent emails—no new replies matched active follow-ups.');
      } else {
        onNotifyToast(
          `Found ${candidates.length} incoming email repl${
            candidates.length === 1 ? 'y' : 'ies'
          } matching active follow-ups!`
        );
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not scan Gmail replies.';
      if (msg === 'GMAIL_AUTH_EXPIRED') {
        disconnectGoogleWorkspace();
        setWorkspaceFetchError('Your Gmail permission expired. Reconnect Gmail to scan replies.');
      } else {
        setWorkspaceFetchError(msg);
      }
    } finally {
      setIsScanningReplies(false);
    }
  };

  // Voice recording controls
  const startVoiceRecording = async () => {
    setAnalysisError(null);
    if (!user) {
      setAnalysisError('Sign in with Google to transcribe and analyze voice recordings.');
      return;
    }
    if (privacySettings?.aiAnalysisPaused) {
      setAnalysisError('AI analysis is currently paused in Privacy & Security Centre.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setAnalysisError('Voice recording is not supported in this browser. Try uploading an audio file instead.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      audioChunksRef.current = [];

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        if (recordTimerRef.current) {
          window.clearInterval(recordTimerRef.current);
          recordTimerRef.current = null;
        }
        setIsRecording(false);

        const blob = new Blob(audioChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        if (blob.size < 400) {
          setAnalysisError('Recording was too short. Please try again.');
          return;
        }

        setIsTranscribing(true);
        try {
          const audioBase64 = await blobToBase64(blob);
          const { transcript } = await transcribeConnectAudio({
            audioBase64,
            mimeType: blob.type || 'audio/webm',
          });
          setSelectedPlatform('phone');
          setSelectedMethod('voice');
          setRawInputText(transcript);
          setImportSourceNote(`Transcribed ${recordingSeconds}s voice recording`);
          await runAnalysis(transcript, 'phone', 'voice', null);
        } catch (err) {
          setAnalysisError(
            err instanceof Error ? err.message : 'Could not transcribe that voice memo.'
          );
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordTimerRef.current = window.setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch {
      setAnalysisError(
        'Microphone access was denied or unavailable. Check browser permissions or upload an audio file.'
      );
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
  };

  // Text / Export File Upload (with server/client safety validation)
  const handleFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setAnalysisError(null);
    try {
      const raw = await file.text();
      await validateConnectUploadFile({ file, kind: 'text', textPreview: raw });
      const parsed = parseExportedConversationFile(file.name, raw);
      const nextPlatform = parsed.detectedPlatform || selectedPlatform;
      setSelectedPlatform(nextPlatform);
      setSelectedMethod('file');
      setRawInputText(parsed.cleanText);
      setImportSourceNote(parsed.summaryNote);
      onNotifyToast(parsed.summaryNote);
    } catch (err) {
      setAnalysisError(
        err instanceof Error
          ? err.message
          : 'Could not read that file. Try a safe .txt, .json, .csv, .eml, or transcript file.'
      );
    }
  };

  // Audio File Upload (with server/client safety validation)
  const handleAudioFileUpload = async (file: File | undefined) => {
    if (!file) return;
    setAnalysisError(null);
    if (!user) {
      setAnalysisError('Sign in with Google to transcribe and analyze audio files.');
      return;
    }
    if (privacySettings?.aiAnalysisPaused) {
      setAnalysisError('AI analysis is currently paused in Privacy & Security Centre.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setAnalysisError('Please choose an audio file under 10 MB.');
      return;
    }
    setIsTranscribing(true);
    try {
      await validateConnectUploadFile({ file, kind: 'audio' });
      const audioBase64 = await blobToBase64(file);
      const { transcript } = await transcribeConnectAudio({
        audioBase64,
        mimeType: file.type || 'audio/mp3',
      });
      setSelectedPlatform('phone');
      setSelectedMethod('audio');
      setRawInputText(transcript);
      setImportSourceNote(`Transcribed audio file: ${file.name}`);
      await runAnalysis(transcript, 'phone', 'audio', null);
    } catch (err) {
      setAnalysisError(
        err instanceof Error ? err.message : 'Could not transcribe that audio file.'
      );
    } finally {
      setIsTranscribing(false);
    }
  };

  // Import Gmail message into analyzer
  const handleAnalyzeGmailMessage = async (msg: GmailMessageSummary) => {
    const formatted = [
      `From: ${msg.fromName} <${msg.fromEmail}>`,
      `Subject: ${msg.subject}`,
      `Date: ${new Date(msg.date).toLocaleString()}`,
      '',
      msg.bodyText || msg.snippet,
    ].join('\n');

    setSelectedPlatform('gmail');
    setSelectedMethod('gmail_api');
    setRawInputText(formatted);
    setImportSourceNote(`Gmail thread: ${msg.subject}`);
    await runAnalysis(formatted, 'gmail', 'gmail_api', msg.id);
    importStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Import Calendar event into analyzer
  const handleAnalyzeCalendarEvent = async (ev: CalendarEventSummary) => {
    const attendeeLine =
      ev.attendees.length > 0
        ? ev.attendees.map((a) => (a.name ? `${a.name} (${a.email})` : a.email)).join(', ')
        : 'None listed';
    const formatted = [
      `Meeting: ${ev.summary}`,
      `When: ${new Date(ev.startIso).toLocaleString()}`,
      ev.organizer ? `Organizer: ${ev.organizer}` : '',
      `Attendees: ${attendeeLine}`,
      ev.location ? `Location: ${ev.location}` : '',
      ev.description ? `Notes: ${ev.description}` : 'Post-meeting follow-up needed.',
    ]
      .filter(Boolean)
      .join('\n');

    setSelectedPlatform('google_calendar');
    setSelectedMethod('calendar_api');
    setRawInputText(formatted);
    setImportSourceNote(`Calendar meeting: ${ev.summary}`);
    await runAnalysis(formatted, 'google_calendar', 'calendar_api', ev.id);
    importStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Apply Clarification Answer & Re-analyze
  const handleRefineWithClarification = async () => {
    if (!clarificationAnswer.trim()) return;
    const enriched = `${rawInputText.trim()}\n\n[User clarification]: ${clarificationAnswer.trim()}`;
    setRawInputText(enriched);
    await runAnalysis(enriched, selectedPlatform, selectedMethod, externalSourceId);
  };

  // Save Follow-up (New reminder OR attach to existing duplicate) + save encrypted conversation
  const handleCreateOrAttachFollowUp = () => {
    if (!analysis) return;

    const resolvedPersonName =
      selectedExistingPersonKey !== 'custom' && contactsMap[selectedExistingPersonKey]
        ? contactsMap[selectedExistingPersonKey].name
        : draftPerson.trim() || null;

    const dueIso = draftDueLocal
      ? new Date(draftDueLocal).toISOString()
      : analysis.suggestedFollowUp.dueAtIso;
    const safeDueIso = Number.isNaN(new Date(dueIso).getTime())
      ? new Date(Date.now() + 24 * 3600000).toISOString()
      : dueIso;

    let linkedReminderId: string | null = null;
    const nowIso = new Date().toISOString();

    if (targetDuplicateId) {
      const existing = items.find((it) => it.id === targetDuplicateId);
      if (existing) {
        const updated: ReminderItem = {
          ...existing,
          dueAt: safeDueIso,
          status: draftStatus,
          lastActivityAt: nowIso,
          followUpRule: draftRule.trim()
            ? { enabled: true, intervalDays: 3, description: draftRule.trim() }
            : existing.followUpRule,
          timeline: [
            ...existing.timeline,
            {
              id: crypto.randomUUID(),
              type: 'user_update',
              text: `[Oopsie Connect · ${selectedPlatform}] ${
                draftCommitment.trim() || analysis.topic
              }`,
              timestamp: nowIso,
            },
          ],
        };
        onUpdateItem(updated, false);
        linkedReminderId = existing.id;
        onNotifyToast(`Added conversation update to "${existing.title}".`);
      }
    }

    if (!linkedReminderId) {
      const draft: ParsedReminderDraft = {
        title: draftTitle.trim() || analysis.topic || 'Follow-up',
        person: resolvedPersonName,
        project: null,
        category: draftCategory,
        priority: draftPriority,
        dueAtIso: safeDueIso,
        needsFollowUp: true,
        followUpRule: {
          enabled: Boolean(draftRule.trim()) || draftStatus === 'waiting',
          intervalDays: draftStatus === 'waiting' ? 3 : null,
          description: draftRule.trim() || draftCommitment.trim() || null,
        },
        initialStatus: draftStatus,
      };

      const created = onCreateItems(
        [draft],
        `[Imported via Oopsie Connect (${selectedPlatform})] ${
          draftCommitment.trim() || analysis.topic
        }`
      );
      linkedReminderId = created[0]?.id ?? null;
      onNotifyToast(`Created follow-up "${draft.title}".`);
    }

    // Save/enrich contact commitments without creating duplicates
    if (resolvedPersonName) {
      const contactKey =
        selectedExistingPersonKey !== 'custom'
          ? selectedExistingPersonKey
          : resolvedPersonName.toLowerCase();
      const existingContact = contactsMap[contactKey];
      const nextCommitments = Array.from(
        new Set([
          ...(existingContact?.commitments || []),
          ...analysis.promisesByOther.slice(0, 2),
        ])
      ).slice(0, 6);

      onSaveContact({
        ...existingContact,
        key: contactKey,
        name: existingContact?.name || resolvedPersonName,
        commitments: nextCommitments,
      });
    }

    // Store encrypted conversation record
    const record: ImportedConversationRecord = {
      id: crypto.randomUUID(),
      platform: selectedPlatform,
      method: selectedMethod,
      importedAt: nowIso,
      title: draftTitle.trim() || analysis.topic,
      person: resolvedPersonName,
      rawContent: rawInputText.slice(0, 14000),
      analysis,
      linkedReminderId,
      externalSourceId,
    };

    setConversations((prev) => [record, ...prev]);
    setIntegrations((prev) => ({
      ...prev,
      [selectedPlatform]: {
        ...prev[selectedPlatform],
        lastImportedAt: nowIso,
      },
    }));

    // Reset import form cleanly
    setAnalysis(null);
    setRawInputText('');
    setImportSourceNote(null);
    setExternalSourceId(null);
  };

  // Confirm detected Gmail reply update
  const handleConfirmResponseCandidate = (
    candidate: DetectedResponseCandidate,
    markClosed: boolean
  ) => {
    const target = items.find((i) => i.id === candidate.matchedReminderId);
    if (!target) {
      setDetectedResponses((prev) => prev.filter((c) => c.id !== candidate.id));
      return;
    }

    const nowIso = new Date().toISOString();
    const updated: ReminderItem = {
      ...target,
      status: markClosed ? 'closed' : candidate.suggestedStatus,
      closedAt: markClosed ? nowIso : target.closedAt,
      lastActivityAt: nowIso,
      timeline: [
        ...target.timeline,
        {
          id: crypto.randomUUID(),
          type: 'ai_summary',
          text: `Gmail reply from ${candidate.senderName}: "${candidate.suggestedSummary}"`,
          timestamp: nowIso,
        },
        ...(markClosed
          ? [
              {
                id: crypto.randomUUID(),
                type: 'closed' as const,
                text: 'Confirmed resolved from Gmail response.',
                timestamp: nowIso,
              },
            ]
          : []),
      ],
    };

    onUpdateItem(updated, markClosed);
    setDetectedResponses((prev) => prev.filter((c) => c.id !== candidate.id));
  };

  const handleDisconnectPlatform = () => {
    const target = pendingDisconnectPlatform;
    setPendingDisconnectPlatform(null);
    if (!target) return;

    disconnectGoogleWorkspace();
    setIntegrations((prev) => ({
      ...prev,
      gmail: {
        ...prev.gmail,
        connected: false,
        connectedEmail: null,
        lastSyncedAt: null,
      },
      google_calendar: {
        ...prev.google_calendar,
        connected: false,
        connectedEmail: null,
        lastSyncedAt: null,
      },
    }));
    if (target === 'gmail') setGmailMessages([]);
    if (target === 'google_calendar') setCalendarEvents([]);
    setDetectedResponses([]);
    onNotifyToast('Disconnected Google Workspace read-only session.');
  };

  const handleShareViaNativeSheet = async (title: string, text: string) => {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, text });
        return;
      } catch {
        // User cancelled or share blocked
      }
    }
    try {
      await navigator.clipboard.writeText(`${title}\n\n${text}`);
      onNotifyToast('Copied follow-up summary to clipboard.');
    } catch {
      onNotifyToast('Share sheet unavailable on this browser.');
    }
  };

  const openImportForPlatform = (platformId: ConnectPlatformId) => {
    setSelectedPlatform(platformId);
    if (platformId === 'gmail' && integrations.gmail.connected && workspaceToken) {
      setSelectedMethod('gmail_api');
    } else if (
      platformId === 'google_calendar' &&
      integrations.google_calendar.connected &&
      workspaceToken
    ) {
      setSelectedMethod('calendar_api');
    } else if (platformId === 'phone') {
      setSelectedMethod('voice');
    } else {
      setSelectedMethod('text');
    }
    importStudioRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const canShareNatively =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const platformNameById = useMemo(() => {
    const map: Record<ConnectPlatformId, string> = {
      gmail: 'Gmail',
      google_calendar: 'Google Calendar',
      whatsapp: 'WhatsApp',
      phone: 'Phone Calls',
      instagram: 'Instagram',
      telegram: 'Telegram',
    };
    return map;
  }, []);

  return (
    <div className="space-y-7">
      {/* Header + AES-GCM Encryption Shield */}
      <section className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="inline-flex items-center gap-2 text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF]">
              <Link2 className="w-4 h-4" />
              <span>Oopsie Connect</span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold font-display tracking-tight text-[#24212B] dark:text-[#F5F3FA]">
              Capture commitments from every conversation
            </h1>
            <p className="text-sm text-[#666173] dark:text-[#A7A2B8] max-w-2xl leading-relaxed">
              Bring threads from WhatsApp, Phone Calls, Instagram, Telegram, Gmail, or Calendar into Oopsie. Only real promises and follow-ups become reminders.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <div className="inline-flex items-center gap-2 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] px-3 py-2 text-xs text-[#666173] dark:text-[#A7A2B8]">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="whitespace-nowrap">AES-GCM encrypted vault</span>
            </div>
            {conversations.length > 0 && (
              <button
                type="button"
                onClick={() => setPendingPurgeAll(true)}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/60 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 whitespace-nowrap transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Connect Data</span>
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Response Tracking Panel (Authorized Gmail Replies) */}
      {detectedResponses.length > 0 && (
        <section className="rounded-3xl bg-[#EAE4FF]/55 dark:bg-[#221D35] border border-[#C9BBF6] dark:border-[#3E3366] p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-[#7657D5] text-white flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <div>
                <h2 className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
                  Detected Incoming Responses ({detectedResponses.length})
                </h2>
                <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                  Oopsie spotted Gmail replies that may resolve active follow-ups. Confirm before updating.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            {detectedResponses.map((cand) => (
              <div
                key={cand.id}
                className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF]">
                      Matches reminder: {cand.matchedReminderTitle}
                    </p>
                    <p className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA] mt-0.5">
                      {cand.senderName} — {cand.subject}
                    </p>
                    <p className="text-xs text-[#666173] dark:text-[#A7A2B8] mt-1 line-clamp-2">
                      &ldquo;{cand.snippet}&rdquo;
                    </p>
                    <p className="text-xs text-[#24212B] dark:text-[#EAE4FF] mt-2 font-medium">
                      {cand.aiReasoning}
                    </p>
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8] shrink-0">
                    {formatTimelineTimestamp(cand.receivedAt)}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleConfirmResponseCandidate(cand, true)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Mark Done</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleConfirmResponseCandidate(cand, false)}
                    className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF] hover:bg-[#DDD3FA] text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Save Update Only</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDetectedResponses((prev) => prev.filter((c) => c.id !== cand.id))
                    }
                    className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-medium text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA] whitespace-nowrap transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Dismiss</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Workspace Auth / Fetch Error */}
      {(workspaceAuthError || workspaceFetchError) && (
        <div className="rounded-2xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 px-4 py-3 flex items-start justify-between gap-3 text-xs text-rose-700 dark:text-rose-300">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p className="leading-relaxed">{workspaceAuthError || workspaceFetchError}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearWorkspaceAuthError();
              setWorkspaceFetchError(null);
            }}
            className="p-1 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-900/40 shrink-0"
            aria-label="Dismiss error"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 6 Platform Integration Cards */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
            Connected Platforms &amp; Import Sources
          </h2>
          <span className="text-xs text-[#666173] dark:text-[#A7A2B8]">
            6 sources available
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {CONNECT_PLATFORMS.map((platform) => {
            const state = integrations[platform.id];
            const style = PLATFORM_META_STYLES[platform.id];
            const Icon = style.icon;
            const hasLiveSession = platform.supportsAutoSync && Boolean(workspaceToken) && state.connected;

            return (
              <div
                key={platform.id}
                className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 flex flex-col justify-between gap-4"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={`w-10 h-10 rounded-xl ${style.iconBg} ${style.iconColor} flex items-center justify-center shrink-0`}
                      >
                        <Icon className="w-5 h-5" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA] truncate">
                          {platform.name}
                        </h3>
                        <p className="text-[11px] font-medium text-[#666173] dark:text-[#A7A2B8] truncate">
                          {platform.supportsAutoSync
                            ? hasLiveSession
                              ? `Connected${state.connectedEmail ? ` · ${state.connectedEmail}` : ''}`
                              : state.connected
                                ? 'Reconnect session'
                                : 'Not connected'
                            : state.lastImportedAt
                              ? 'Import ready · Used recently'
                              : 'Manual / File / Share Import'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8] leading-relaxed">
                    {platform.tagline}
                  </p>

                  <div className="rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#EFEBF7] dark:border-[#2C2740] px-3 py-2 text-[11px] text-[#666173] dark:text-[#A7A2B8] space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-[#24212B] dark:text-[#EAE4FF]">
                        Method
                      </span>
                      <span className="truncate">{platform.methodLabel}</span>
                    </div>
                    {(state.lastSyncedAt || state.lastImportedAt) && (
                      <div className="flex items-center justify-between gap-2 font-mono tabular-nums">
                        <span>{platform.supportsAutoSync ? 'Last synced' : 'Last import'}</span>
                        <span>
                          {formatTimelineTimestamp(
                            (platform.supportsAutoSync
                              ? state.lastSyncedAt
                              : state.lastImportedAt) || ''
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {platform.supportsAutoSync ? (
                    hasLiveSession ? (
                      <>
                        <button
                          type="button"
                          disabled={isFetchingGoogle}
                          onClick={() =>
                            platform.id === 'gmail'
                              ? void handleSyncGmail()
                              : void handleSyncCalendar()
                          }
                          className="min-h-[38px] flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold whitespace-nowrap transition-colors"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${isFetchingGoogle ? 'animate-spin' : ''}`}
                          />
                          <span>{platform.id === 'gmail' ? 'Sync Threads' : 'Sync Meetings'}</span>
                        </button>
                        {platform.id === 'gmail' && (
                          <button
                            type="button"
                            disabled={isScanningReplies}
                            onClick={() => void handleScanIncomingReplies()}
                            className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold whitespace-nowrap transition-colors"
                          >
                            {isScanningReplies ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Sparkles className="w-3.5 h-3.5" />
                            )}
                            <span>Scan Replies</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setPendingDisconnectPlatform(
                              platform.id === 'gmail' ? 'gmail' : 'google_calendar'
                            )
                          }
                          aria-label={`Disconnect ${platform.name}`}
                          className="min-h-[38px] px-2.5 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-[#666173] hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        >
                          <Unlink className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isConnectingWorkspace}
                        onClick={() =>
                          setPendingConsentPlatform(
                            platform.id === 'gmail' ? 'gmail' : 'google_calendar'
                          )
                        }
                        className="min-h-[38px] w-full inline-flex items-center justify-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold whitespace-nowrap transition-colors"
                      >
                        {isConnectingWorkspace ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Icon className="w-3.5 h-3.5" />
                        )}
                        <span>Connect {platform.name}</span>
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => openImportForPlatform(platform.id)}
                      className="min-h-[38px] w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl border border-[#DDD3FA] dark:border-[#3D3363] bg-[#EAE4FF]/45 dark:bg-[#2B2444]/60 hover:bg-[#7657D5] hover:text-white text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold whitespace-nowrap transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>Import from {platform.name}</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Multi-Method Conversation Import Studio */}
      <section
        ref={importStudioRef}
        className="rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-5 sm:p-6 space-y-5"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
              Import &amp; Analyze Conversation
            </h2>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8] mt-0.5">
              Choose how to bring in a chat, email, meeting, or phone call—Oopsie extracts real promises vs casual talk.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label htmlFor="connect-platform-select" className="text-xs font-medium text-[#666173] dark:text-[#A7A2B8]">
              Source:
            </label>
            <select
              id="connect-platform-select"
              value={selectedPlatform}
              onChange={(e) => setSelectedPlatform(e.target.value as ConnectPlatformId)}
              className="rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] px-3 py-2 text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
            >
              {CONNECT_PLATFORMS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Import Method Selector */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {[
            { id: 'text' as const, label: 'Paste Text / Transcript', icon: ClipboardPaste },
            { id: 'file' as const, label: 'Exported File', icon: FileText },
            { id: 'voice' as const, label: 'Record Voice', icon: Mic },
            { id: 'audio' as const, label: 'Audio File', icon: FileAudio },
            { id: 'share' as const, label: 'Mobile Share', icon: Share2 },
            {
              id: selectedPlatform === 'google_calendar' ? ('calendar_api' as const) : ('gmail_api' as const),
              label: selectedPlatform === 'google_calendar' ? 'Calendar Events' : 'Gmail Threads',
              icon: selectedPlatform === 'google_calendar' ? Calendar : Mail,
            },
          ].map((tab) => {
            const TabIcon = tab.icon;
            const active =
              selectedMethod === tab.id ||
              (tab.id === 'text' && selectedMethod === 'transcript');
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedMethod(tab.id)}
                className={`min-h-[44px] flex items-center justify-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#7657D5] bg-[#EAE4FF]/70 dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF]'
                    : 'border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA]'
                }`}
              >
                <TabIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="truncate">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Hidden file inputs */}
        <input
          ref={textFileInputRef}
          type="file"
          accept=".txt,.json,.csv,.eml,.srt,.vtt"
          onChange={(e) => {
            void handleFileUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
          className="hidden"
        />
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg"
          onChange={(e) => {
            void handleAudioFileUpload(e.target.files?.[0]);
            e.target.value = '';
          }}
          className="hidden"
        />

        {/* Method-specific Controls */}
        {selectedMethod === 'file' && (
          <div className="rounded-2xl border border-dashed border-[#C9BBF6] dark:border-[#3D3363] bg-[#FAF9FC] dark:bg-[#12101A] p-5 text-center space-y-3">
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
              Supports WhatsApp chat exports (<code className="font-mono">.txt</code>), Telegram exports (<code className="font-mono">.json</code>), emails (<code className="font-mono">.eml</code>), and call transcripts (<code className="font-mono">.srt</code>, <code className="font-mono">.vtt</code>, <code className="font-mono">.csv</code>).
            </p>
            <button
              type="button"
              onClick={() => textFileInputRef.current?.click()}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold whitespace-nowrap transition-colors"
            >
              <Upload className="w-4 h-4" />
              <span>Choose Export File</span>
            </button>
          </div>
        )}

        {selectedMethod === 'voice' && (
          <div className="rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="space-y-1 text-center sm:text-left">
              <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                {isRecording
                  ? `Recording voice summary (${recordingSeconds}s)...`
                  : isTranscribing
                    ? 'Transcribing recording with Oopsie AI...'
                    : 'Record a quick call recap or voice note'}
              </p>
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                Tap record after hanging up—Oopsie transcribes your audio and extracts who promised what.
              </p>
            </div>
            <div className="shrink-0">
              {isRecording ? (
                <button
                  type="button"
                  onClick={stopVoiceRecording}
                  className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Stop &amp; Transcribe</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isTranscribing}
                  onClick={() => void startVoiceRecording()}
                  className="min-h-[42px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold whitespace-nowrap transition-colors"
                >
                  {isTranscribing ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Mic className="w-4 h-4" />
                  )}
                  <span>{isTranscribing ? 'Transcribing...' : 'Start Recording'}</span>
                </button>
              )}
            </div>
          </div>
        )}

        {selectedMethod === 'audio' && (
          <div className="rounded-2xl border border-dashed border-[#C9BBF6] dark:border-[#3D3363] bg-[#FAF9FC] dark:bg-[#12101A] p-5 text-center space-y-3">
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
              Upload a call recording or voice memo (<code className="font-mono">.mp3</code>, <code className="font-mono">.wav</code>, <code className="font-mono">.m4a</code>, <code className="font-mono">.ogg</code>, <code className="font-mono">.webm</code>, up to 10 MB).
            </p>
            <button
              type="button"
              disabled={isTranscribing}
              onClick={() => audioFileInputRef.current?.click()}
              className="min-h-[40px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold whitespace-nowrap transition-colors"
            >
              {isTranscribing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <FileAudio className="w-4 h-4" />
              )}
              <span>{isTranscribing ? 'Transcribing Audio...' : 'Upload Audio Recording'}</span>
            </button>
          </div>
        )}

        {selectedMethod === 'share' && (
          <div className="rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] p-4 space-y-2.5 text-xs text-[#666173] dark:text-[#A7A2B8]">
            <p className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
              Native Mobile Share Integration
            </p>
            <p className="leading-relaxed">
              Install Oopsie as a mobile app (PWA) to share messages directly from WhatsApp, Telegram, or Instagram into Oopsie Connect via your device&apos;s Share sheet. Or paste copied text directly below.
            </p>
          </div>
        )}

        {selectedMethod === 'gmail_api' && (
          <div className="rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                Recent Gmail Threads
              </p>
              <button
                type="button"
                onClick={() =>
                  workspaceToken
                    ? void handleSyncGmail()
                    : setPendingConsentPlatform('gmail')
                }
                className="text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF] hover:underline whitespace-nowrap"
              >
                {workspaceToken ? 'Refresh Gmail' : 'Connect Gmail'}
              </button>
            </div>
            {gmailMessages.length === 0 ? (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] py-3 text-center">
                {workspaceToken
                  ? 'Tap Refresh Gmail above to load your recent threads.'
                  : 'Connect your Google account (read-only) to browse and import Gmail threads.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {gmailMessages.map((msg) => (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => void handleAnalyzeGmailMessage(msg)}
                    className="w-full text-left rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5] p-3 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#24212B] dark:text-[#F5F3FA] truncate">
                        {msg.fromName} · {msg.subject}
                      </p>
                      <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8] line-clamp-1 mt-0.5">
                        {msg.snippet}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-[#7657D5] dark:text-[#C5B4FF] whitespace-nowrap shrink-0">
                      Analyze
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {selectedMethod === 'calendar_api' && (
          <div className="rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                Recent &amp; Upcoming Calendar Meetings
              </p>
              <button
                type="button"
                onClick={() =>
                  workspaceToken
                    ? void handleSyncCalendar()
                    : setPendingConsentPlatform('google_calendar')
                }
                className="text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF] hover:underline whitespace-nowrap"
              >
                {workspaceToken ? 'Refresh Calendar' : 'Connect Calendar'}
              </button>
            </div>
            {calendarEvents.length === 0 ? (
              <p className="text-xs text-[#666173] dark:text-[#A7A2B8] py-3 text-center">
                {workspaceToken
                  ? 'Tap Refresh Calendar above to load your recent meetings.'
                  : 'Connect Google Calendar (read-only) to create follow-ups from your meetings.'}
              </p>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {calendarEvents.map((ev) => (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => void handleAnalyzeCalendarEvent(ev)}
                    className="w-full text-left rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5] p-3 transition-colors flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[#24212B] dark:text-[#F5F3FA] truncate">
                        {ev.summary}
                      </p>
                      <p className="text-[11px] font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8] mt-0.5">
                        {new Date(ev.startIso).toLocaleString()}
                        {ev.attendees.length > 0 ? ` · ${ev.attendees.length} attendees` : ''}
                      </p>
                    </div>
                    <span className="text-[11px] font-semibold text-[#7657D5] dark:text-[#C5B4FF] whitespace-nowrap shrink-0">
                      Analyze
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Shared Textarea + Analyze CTA */}
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <label
              htmlFor="connect-raw-text"
              className="text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA]"
            >
              Conversation / Transcript Content
            </label>
            {importSourceNote && (
              <span className="text-[11px] font-medium text-[#7657D5] dark:text-[#C5B4FF] truncate">
                {importSourceNote}
              </span>
            )}
          </div>

          <textarea
            id="connect-raw-text"
            rows={5}
            value={rawInputText}
            onChange={(e) => setRawInputText(e.target.value)}
            placeholder={
              'Paste a WhatsApp chat, call transcript, Instagram DM, or email thread...\nExample: "Rahul: Hey! I will share the updated supplier quotation with you by Friday afternoon."'
            }
            className="w-full rounded-2xl border border-[#E6E1F2] dark:border-[#2C2740] bg-[#FAF9FC] dark:bg-[#12101A] px-4 py-3 text-sm text-[#24212B] dark:text-[#F5F3FA] placeholder:text-[#8E889C] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
          />

          {analysisError && (
            <p className="text-xs font-medium text-rose-600 dark:text-rose-400">
              {analysisError}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11px] text-[#666173] dark:text-[#A7A2B8]">
              Oopsie filters out casual small talk and hypotheticals, surfacing real commitments only.
            </p>
            <button
              type="button"
              disabled={isAnalyzing || isTranscribing || !rawInputText.trim()}
              onClick={() => void runAnalysis(rawInputText)}
              className="min-h-[42px] inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] disabled:opacity-50 text-white text-xs sm:text-sm font-semibold shadow-sm whitespace-nowrap transition-colors"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              <span>{isAnalyzing ? 'Analyzing Conversation...' : 'Analyze with Oopsie AI'}</span>
            </button>
          </div>
        </div>
      </section>

      {/* AI Analysis & Editable Follow-Up Review */}
      <AnimatePresence>
        {analysis && (
          <motion.section
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className="rounded-3xl bg-white dark:bg-[#1A1726] border-2 border-[#7657D5]/45 p-5 sm:p-6 space-y-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#7657D5] dark:text-[#C5B4FF]">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Conversation Summary</span>
                </div>
                <h3 className="text-lg font-bold font-display text-[#24212B] dark:text-[#F5F3FA] mt-0.5">
                  {analysis.topic}
                </h3>
                {analysis.conversationDate && (
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                    Conversation date: {analysis.conversationDate}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => setAnalysis(null)}
                aria-label="Discard analysis"
                className="p-2 rounded-xl text-[#666173] hover:text-[#24212B] dark:hover:text-[#F5F3FA] hover:bg-[#FAF9FC] dark:hover:bg-[#241F35]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Structured Extraction Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#666173] dark:text-[#A7A2B8]">
                  Promises by {draftPerson || 'Other Person'}
                </p>
                {analysis.promisesByOther.length === 0 ? (
                  <p className="text-xs text-[#8E889C]">None detected</p>
                ) : (
                  <ul className="space-y-1 text-xs text-[#24212B] dark:text-[#F5F3FA] list-disc pl-4">
                    {analysis.promisesByOther.map((p, idx) => (
                      <li key={idx}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#666173] dark:text-[#A7A2B8]">
                  Your Commitments
                </p>
                {analysis.commitmentsByUser.length === 0 ? (
                  <p className="text-xs text-[#8E889C]">None detected</p>
                ) : (
                  <ul className="space-y-1 text-xs text-[#24212B] dark:text-[#F5F3FA] list-disc pl-4">
                    {analysis.commitmentsByUser.map((c, idx) => (
                      <li key={idx}>{c}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 space-y-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-[#666173] dark:text-[#A7A2B8]">
                  Deadlines &amp; Next Actions
                </p>
                {analysis.deadlines.length === 0 && analysis.nextActions.length === 0 ? (
                  <p className="text-xs text-[#8E889C]">No explicit dates mentioned</p>
                ) : (
                  <ul className="space-y-1 text-xs text-[#24212B] dark:text-[#F5F3FA] list-disc pl-4">
                    {analysis.deadlines.map((d, idx) => (
                      <li key={`d-${idx}`} className="font-medium text-[#7657D5] dark:text-[#C5B4FF]">
                        {d}
                      </li>
                    ))}
                    {analysis.nextActions.map((a, idx) => (
                      <li key={`a-${idx}`}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {/* Ambiguity Clarification Questions */}
            {analysis.clarificationQuestions.length > 0 && (
              <div className="rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-900/50 p-4 space-y-3">
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-[#24212B] dark:text-[#F5F3FA]">
                      Quick clarification needed
                    </p>
                    <ul className="text-xs text-[#666173] dark:text-[#A7A2B8] space-y-0.5 list-disc pl-4">
                      {analysis.clarificationQuestions.map((q, idx) => (
                        <li key={idx}>{q}</li>
                      ))}
                    </ul>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={clarificationAnswer}
                    onChange={(e) => setClarificationAnswer(e.target.value)}
                    placeholder="Clarify date or who owns this (e.g., Rahul should send it by Friday 4pm)"
                    className="flex-1 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-white dark:bg-[#1A1726] px-3 py-2 text-xs text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
                  />
                  <button
                    type="button"
                    disabled={isAnalyzing || !clarificationAnswer.trim()}
                    onClick={() => void handleRefineWithClarification()}
                    className="min-h-[36px] px-3.5 py-1.5 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    Update Summary
                  </button>
                </div>
              </div>
            )}

            {/* Contact Disambiguation */}
            {analysis.personMatchCandidates && analysis.personMatchCandidates.length > 0 && (
              <div className="rounded-2xl bg-[#EAE4FF]/45 dark:bg-[#2B2444]/60 border border-[#DDD3FA] dark:border-[#3D3363] p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-bold text-[#24212B] dark:text-[#F5F3FA]">
                  <UserCheck className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF]" />
                  <span>Contact match found — avoid duplicate contacts</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {analysis.personMatchCandidates.map((cand) => (
                    <button
                      key={cand.key}
                      type="button"
                      onClick={() => {
                        setSelectedExistingPersonKey(cand.key);
                        setDraftPerson(cand.name);
                      }}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                        selectedExistingPersonKey === cand.key
                          ? 'bg-[#7657D5] border-[#7657D5] text-white'
                          : 'bg-white dark:bg-[#1A1726] border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA]'
                      }`}
                    >
                      Link to {cand.name}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedExistingPersonKey('custom')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
                      selectedExistingPersonKey === 'custom'
                        ? 'bg-[#7657D5] border-[#7657D5] text-white'
                        : 'bg-white dark:bg-[#1A1726] border-[#E6E1F2] dark:border-[#2C2740] text-[#24212B] dark:text-[#F5F3FA]'
                    }`}
                  >
                    Use custom name
                  </button>
                </div>
              </div>
            )}

            {/* Duplicate Reminder Guard */}
            {analysis.duplicateReminderMatches && analysis.duplicateReminderMatches.length > 0 && (
              <div className="rounded-2xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/50 p-4 space-y-2.5">
                <p className="text-xs font-bold text-[#24212B] dark:text-[#F5F3FA]">
                  Similar open follow-up already exists — choose whether to update it or create a new one:
                </p>
                <div className="space-y-2">
                  {analysis.duplicateReminderMatches.map((dup) => (
                    <label
                      key={dup.itemId}
                      className="flex items-start gap-2.5 rounded-xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-2.5 cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="duplicate-choice"
                        checked={targetDuplicateId === dup.itemId}
                        onChange={() => setTargetDuplicateId(dup.itemId)}
                        className="mt-1 accent-[#7657D5]"
                      />
                      <div className="min-w-0 text-xs">
                        <p className="font-semibold text-[#24212B] dark:text-[#F5F3FA]">
                          Attach to &ldquo;{dup.title}&rdquo;
                        </p>
                        <p className="text-[#666173] dark:text-[#A7A2B8]">
                          {dup.reason} · Due {formatDueLabel(dup.dueAt)}
                        </p>
                      </div>
                    </label>
                  ))}
                  <label className="flex items-center gap-2.5 text-xs font-medium text-[#24212B] dark:text-[#F5F3FA] cursor-pointer px-1">
                    <input
                      type="radio"
                      name="duplicate-choice"
                      checked={targetDuplicateId === null}
                      onChange={() => setTargetDuplicateId(null)}
                      className="accent-[#7657D5]"
                    />
                    <span>Create as a separate new follow-up</span>
                  </label>
                </div>
              </div>
            )}

            {/* Editable Follow-Up Card Preview */}
            <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-[#7657D5] dark:text-[#C5B4FF]">
                  Edit &amp; Confirm Follow-Up
                </p>
                <span className="text-xs font-semibold text-[#666173] dark:text-[#A7A2B8]">
                  {draftStatus === 'waiting' ? 'Waiting for Response' : 'Needs Action'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">
                    Topic / Reminder Title
                  </span>
                  <input
                    type="text"
                    value={draftTitle}
                    onChange={(e) => setDraftTitle(e.target.value)}
                    className="w-full rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-3 py-2 text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">Person</span>
                  <input
                    type="text"
                    value={draftPerson}
                    onChange={(e) => {
                      setSelectedExistingPersonKey('custom');
                      setDraftPerson(e.target.value);
                    }}
                    placeholder="Optional contact name"
                    className="w-full rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-3 py-2 text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
                  />
                </label>

                <label className="space-y-1 text-xs">
                  <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">
                    Expected Follow-Up Date
                  </span>
                  <input
                    type="datetime-local"
                    value={draftDueLocal}
                    onChange={(e) => setDraftDueLocal(e.target.value)}
                    className="w-full rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-3 py-2 text-sm font-mono tabular-nums text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
                  />
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-2">
                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">Status</span>
                    <select
                      value={draftStatus}
                      onChange={(e) =>
                        setDraftStatus(e.target.value as 'waiting' | 'needs_action')
                      }
                      className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-2.5 py-2 text-xs text-[#24212B] dark:text-[#F5F3FA]"
                    >
                      <option value="waiting">Waiting</option>
                      <option value="needs_action">Needs Action</option>
                    </select>
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">Category</span>
                    <select
                      value={draftCategory}
                      onChange={(e) => setDraftCategory(e.target.value as ReminderCategory)}
                      className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-2.5 py-2 text-xs text-[#24212B] dark:text-[#F5F3FA]"
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-1 text-xs">
                    <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">Priority</span>
                    <select
                      value={draftPriority}
                      onChange={(e) => setDraftPriority(e.target.value as ReminderPriority)}
                      className="w-full min-h-[44px] sm:min-h-[38px] rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-2.5 py-2 text-xs text-[#24212B] dark:text-[#F5F3FA]"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </label>
                </div>
              </div>

              <label className="block space-y-1 text-xs">
                <span className="font-medium text-[#666173] dark:text-[#A7A2B8]">
                  Commitment Summary
                </span>
                <input
                  type="text"
                  value={draftCommitment}
                  onChange={(e) => setDraftCommitment(e.target.value)}
                  className="w-full rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] bg-white dark:bg-[#1A1726] px-3 py-2 text-sm text-[#24212B] dark:text-[#F5F3FA] focus:outline-none focus:ring-2 focus:ring-[#7657D5]"
                />
              </label>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setAnalysis(null)}
                  className="min-h-[42px] px-4 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-semibold text-[#666173] dark:text-[#A7A2B8] hover:text-[#24212B] dark:hover:text-[#F5F3FA] transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCreateOrAttachFollowUp}
                  className="min-h-[42px] inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs sm:text-sm font-semibold shadow-sm whitespace-nowrap transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {targetDuplicateId ? 'Update Existing Follow-up' : 'Create Follow-up'}
                  </span>
                </button>
              </div>
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      {/* Encrypted Imported Conversations History */}
      <section className="space-y-3">
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#7657D5] dark:text-[#C5B4FF]" />
            <h2 className="text-base font-semibold font-display text-[#24212B] dark:text-[#F5F3FA]">
              Encrypted Imported Conversations
            </h2>
          </div>
          <span className="text-xs font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
            {conversations.length} stored
          </span>
        </div>

        {conversations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#DDD3FA] dark:border-[#3D3363] bg-white/60 dark:bg-[#1A1726]/60 p-8 text-center space-y-1.5">
            <p className="text-sm font-semibold text-[#24212B] dark:text-[#F5F3FA]">
              No imported conversations yet
            </p>
            <p className="text-xs text-[#666173] dark:text-[#A7A2B8] max-w-md mx-auto">
              Imported chats, transcripts, voice memos, emails, and meetings are stored encrypted on your device and linked directly to your Oopsie timelines.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {conversations.map((rec) => {
              const linkedItem = rec.linkedReminderId
                ? items.find((it) => it.id === rec.linkedReminderId) || null
                : null;
              return (
                <div
                  key={rec.id}
                  className="rounded-2xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-[#7657D5] dark:text-[#C5B4FF]">
                      <span>{platformNameById[rec.platform]}</span>
                      <span>·</span>
                      <span className="font-mono tabular-nums text-[#666173] dark:text-[#A7A2B8]">
                        {formatTimelineTimestamp(rec.importedAt)}
                      </span>
                      {rec.person && (
                        <>
                          <span>·</span>
                          <span>{rec.person}</span>
                        </>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-[#24212B] dark:text-[#F5F3FA] truncate">
                      {rec.title}
                    </h3>
                    <p className="text-xs text-[#666173] dark:text-[#A7A2B8] line-clamp-1">
                      {rec.analysis.suggestedFollowUp.commitmentSummary}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {linkedItem && (
                      <>
                        <button
                          type="button"
                          onClick={() => onOpenTimeline(linkedItem)}
                          className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] hover:border-[#7657D5] text-xs font-semibold text-[#24212B] dark:text-[#F5F3FA] whitespace-nowrap transition-colors"
                        >
                          <Clock className="w-3.5 h-3.5 text-[#7657D5]" />
                          <span>Timeline</span>
                        </button>
                        {linkedItem.status !== 'closed' && (
                          <button
                            type="button"
                            onClick={() => onOpenWhatHappened(linkedItem)}
                            className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#4C32A8] dark:text-[#EAE4FF] text-xs font-semibold whitespace-nowrap transition-colors"
                          >
                            <span>What happened?</span>
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void handleShareViaNativeSheet(
                          rec.title,
                          rec.analysis.suggestedFollowUp.commitmentSummary
                        )
                      }
                      aria-label={canShareNatively ? 'Share summary' : 'Copy summary'}
                      className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-[#666173] hover:text-[#7657D5] transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteConvoId(rec.id)}
                      aria-label="Delete imported conversation"
                      className="min-h-[36px] px-2.5 py-1.5 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-[#666173] hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Explicit Permission Consent Modal for Gmail / Google Calendar */}
      <AnimatePresence>
        {pendingConsentPlatform && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/45 backdrop-blur-xs">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="w-full max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white dark:bg-[#1A1726] border border-[#E6E1F2] dark:border-[#2C2740] p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:pb-6 space-y-4 shadow-2xl"
            >
              <div className="flex items-center gap-3">
                <span className="w-10 h-10 rounded-xl bg-[#EAE4FF] dark:bg-[#2B2444] text-[#7657D5] dark:text-[#C5B4FF] flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold font-display text-[#24212B] dark:text-[#F5F3FA]">
                    Connect{' '}
                    {pendingConsentPlatform === 'gmail' ? 'Gmail' : 'Google Calendar'} (Read-Only)
                  </h3>
                  <p className="text-xs text-[#666173] dark:text-[#A7A2B8]">
                    Explicit permission required before accessing Google data
                  </p>
                </div>
              </div>

              <div className="rounded-2xl bg-[#FAF9FC] dark:bg-[#12101A] border border-[#E6E1F2] dark:border-[#2C2740] p-3.5 space-y-2 text-xs text-[#24212B] dark:text-[#EAE4FF]">
                <p className="font-semibold">What Oopsie requests:</p>
                <ul className="space-y-1 text-[#666173] dark:text-[#A7A2B8] list-disc pl-4">
                  <li>Read-only access to Gmail messages (<code className="font-mono">gmail.readonly</code>)</li>
                  <li>Read-only access to Calendar events (<code className="font-mono">calendar.events.readonly</code>)</li>
                  <li>OAuth token stays strictly in memory for your active session and is never saved to storage</li>
                  <li>Oopsie never sends emails, edits events, or updates your reminders without your confirmation</li>
                </ul>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setPendingConsentPlatform(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-[#E6E1F2] dark:border-[#2C2740] text-xs font-semibold text-[#666173] dark:text-[#A7A2B8]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleConfirmWorkspaceConsent()}
                  className="min-h-[44px] px-4 py-2 rounded-xl bg-[#7657D5] hover:bg-[#6546C4] text-white text-xs font-semibold"
                >
                  Allow Read-Only Access
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm Disconnect Google Workspace */}
      <AnimatePresence>
        {pendingDisconnectPlatform && (
          <ConfirmDialog
            title="Disconnect Google Workspace?"
            description="Oopsie will immediately clear your in-memory Gmail and Google Calendar session token. Existing reminders and timelines remain untouched."
            confirmLabel="Disconnect"
            destructive
            onConfirm={handleDisconnectPlatform}
            onCancel={() => setPendingDisconnectPlatform(null)}
          />
        )}
      </AnimatePresence>

      {/* Confirm Delete Single Imported Conversation */}
      <AnimatePresence>
        {pendingDeleteConvoId && (
          <ConfirmDialog
            title="Delete imported conversation?"
            description="This removes the encrypted conversation snapshot from Oopsie Connect while keeping your saved reminders intact."
            confirmLabel="Delete snapshot"
            destructive
            onConfirm={() => {
              const id = pendingDeleteConvoId;
              setPendingDeleteConvoId(null);
              setConversations((prev) => prev.filter((c) => c.id !== id));
              onNotifyToast('Imported conversation deleted.');
            }}
            onCancel={() => setPendingDeleteConvoId(null)}
          />
        )}
      </AnimatePresence>

      {/* Confirm Purge All Connect Data */}
      <AnimatePresence>
        {pendingPurgeAll && (
          <ConfirmDialog
            title="Clear all Oopsie Connect data?"
            description="This deletes all encrypted imported conversations, wipes the local encryption key, and disconnects Gmail/Calendar sessions."
            confirmLabel="Clear Connect Data"
            destructive
            onConfirm={() => {
              setPendingPurgeAll(false);
              disconnectGoogleWorkspace();
              setGmailMessages([]);
              setCalendarEvents([]);
              setDetectedResponses([]);
              setConversations([]);
              setIntegrations(getDefaultIntegrationsMap());
              void purgeAllConnectData();
              onNotifyToast('All Oopsie Connect data cleared.');
            }}
            onCancel={() => setPendingPurgeAll(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
