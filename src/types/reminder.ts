export type ReminderStyle = 'gentle' | 'firm';
export type AlarmToneId = 'bubble_pop' | 'little_bell' | 'sleepy_chime' | 'oopsie_giggle';
export type AlarmIntensity = 'gentle' | 'firm';
export type ReminderCategory = 'Work' | 'Personal' | 'Finance' | 'Health' | 'Errands' | 'Social';
export type ReminderPriority = 'low' | 'medium' | 'high';
export type AssistantStatusType = 'needs_action' | 'waiting' | 'closed';
export type ReminderStatus = AssistantStatusType;
export type AssistantMood = 'idle' | 'listening' | 'thinking' | 'happy' | 'alert' | 'oops';

export type TimelineEntryType =
  | 'created'
  | 'reminded'
  | 'snoozed'
  | 'rescheduled'
  | 'completed'
  | 'checkin_asked'
  | 'user_update'
  | 'ai_summary'
  | 'nudge_drafted'
  | 'closed'
  | 'reopened';

export interface TimelineEntry {
  id: string;
  type: TimelineEntryType;
  text: string;
  timestamp: string;
  meta?: {
    nextFollowUpAt?: string;
    snoozeMinutes?: number;
  };
}

export interface FollowUpRule {
  enabled: boolean;
  intervalDays: number | null;
  description: string | null;
}

export interface ReminderItem {
  id: string;
  title: string;
  person: string | null;
  project: string | null;
  category: ReminderCategory;
  priority: ReminderPriority;
  dueAt: string;
  status: ReminderStatus;
  followUpRule: FollowUpRule;
  snoozeCount: number;
  lastNotifiedAt: string | null;
  lastActivityAt: string;
  createdAt: string;
  closedAt: string | null;
  timeline: TimelineEntry[];
}

export interface UserProfile {
  name: string;
  reminderStyle: ReminderStyle;
  wakeTime: string;
  sleepTime: string;
  timezone: string;
  theme: 'light' | 'dark';
  soundEnabled: boolean;
  alarmTone: AlarmToneId;
  alarmVolume: number;
  alarmIntensity: AlarmIntensity;
  audioUnlocked?: boolean;
  onboardingComplete: boolean;
  streakDays: number;
  lastClosedDate: string | null;
  closedCountTotal: number;
  lastBriefingDate: string | null;
}

export interface ParsedReminderDraft {
  title: string;
  person: string | null;
  project: string | null;
  category: ReminderCategory;
  priority: ReminderPriority;
  dueAtIso: string;
  needsFollowUp: boolean;
  followUpRule: FollowUpRule;
  initialStatus: 'needs_action' | 'waiting';
}

export type ChatActionType = 'create' | 'clarify' | 'update_item' | 'answer_query' | 'chitchat';

export interface ChatItemUpdate {
  targetItemId: string;
  updateType: 'complete' | 'snooze' | 'reschedule' | 'note' | 'delete';
  newDueAtIso: string | null;
  noteText: string | null;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ParseInputResponse {
  action: ChatActionType;
  needsClarification: boolean;
  clarifyingQuestion: string | null;
  quickOptions: string[];
  allowCustomDateTimePicker: boolean;
  items: ParsedReminderDraft[];
  itemUpdate: ChatItemUpdate | null;
  citedItemIds: string[];
  assistantReply: string;
}

export interface CheckInResponse {
  question: string;
  quickReplies: string[];
}

export interface UpdateSummaryResponse {
  summary: string;
  isResolved: boolean;
  suggestedStatus: ReminderStatus;
  nextFollowUpIso: string | null;
  nextFollowUpLabel: string | null;
  assistantReply: string;
}

export interface BrainQueryResponse {
  answer: string;
  citedItemIds: string[];
  suggestedAction: string | null;
}

export interface SmartNudge {
  itemId: string;
  person: string | null;
  reason: string;
  draftMessage: string;
}

export interface DailyBriefingResponse {
  greetingHeadline: string;
  summaryText: string;
  nudges: SmartNudge[];
}

export interface SnoozeCheckResponse {
  message: string;
  suggestRescheduleNextWeekLabel: string;
}

export interface ChatExchangeMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  createdItems?: ReminderItem[];
  quickOptions?: string[];
  allowCustomDateTimePicker?: boolean;
  isError?: boolean;
}

export interface ContactProfile {
  key: string;
  name: string;
  role?: string;
  company?: string;
  email?: string;
  phone?: string;
  notes?: string;
  commitments?: string[];
}

export interface PersonSummary {
  key: string;
  name: string;
  contact: ContactProfile;
  pendingItems: ReminderItem[];
  completedItems: ReminderItem[];
  allItems: ReminderItem[];
  promisesAndCommitments: Array<{
    id: string;
    text: string;
    itemId: string;
    itemTitle: string;
    status: ReminderStatus;
    timestamp: string;
  }>;
  lastInteractionAt: string | null;
}

export type ConnectPlatformId =
  | 'whatsapp'
  | 'phone'
  | 'instagram'
  | 'telegram'
  | 'gmail'
  | 'google_calendar';

export type ConnectImportMethod =
  | 'text'
  | 'file'
  | 'voice'
  | 'audio'
  | 'transcript'
  | 'share'
  | 'gmail_api'
  | 'calendar_api';

export interface ConnectIntegrationState {
  platform: ConnectPlatformId;
  connected: boolean;
  connectedEmail: string | null;
  lastSyncedAt: string | null;
  permissionGrantedAt: string | null;
  lastImportedAt: string | null;
}

export interface ConnectPersonCandidate {
  key: string;
  name: string;
  reason: string;
}

export interface ConnectDuplicateMatch {
  itemId: string;
  title: string;
  person: string | null;
  dueAt: string;
  status: ReminderStatus;
  reason: string;
}

export interface SuggestedConnectFollowUp {
  title: string;
  person: string | null;
  category: ReminderCategory;
  priority: ReminderPriority;
  dueAtIso: string;
  status: 'waiting' | 'needs_action';
  commitmentSummary: string;
  ruleDescription: string | null;
}

export interface ConversationAnalysisResult {
  person: string | null;
  conversationDate: string | null;
  topic: string;
  promisesByOther: string[];
  commitmentsByUser: string[];
  pendingResponses: string[];
  deadlines: string[];
  nextActions: string[];
  clarificationQuestions: string[];
  suggestedFollowUp: SuggestedConnectFollowUp;
  personMatchCandidates?: ConnectPersonCandidate[];
  duplicateReminderMatches?: ConnectDuplicateMatch[];
}

export interface ImportedConversationRecord {
  id: string;
  platform: ConnectPlatformId;
  method: ConnectImportMethod;
  importedAt: string;
  title: string;
  person: string | null;
  rawContent: string;
  analysis: ConversationAnalysisResult;
  linkedReminderId: string | null;
  externalSourceId?: string | null;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
}

export interface CalendarEventSummary {
  id: string;
  summary: string;
  description: string;
  startIso: string;
  endIso: string;
  organizer: string | null;
  attendees: Array<{
    name: string | null;
    email: string;
    responseStatus?: string;
  }>;
  location?: string | null;
}

export interface DetectedResponseCandidate {
  id: string;
  sourcePlatform: 'gmail';
  sourceMessageId: string;
  senderName: string;
  senderEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  matchedReminderId: string;
  matchedReminderTitle: string;
  aiReasoning: string;
  suggestedStatus: 'closed' | 'needs_action' | 'waiting';
  suggestedSummary: string;
  confidence: 'high' | 'medium';
}

export type AuditEventType =
  | 'login_success'
  | 'session_revoked'
  | 'logout_all'
  | 'integration_connected'
  | 'integration_disconnected'
  | 'data_exported'
  | 'data_deleted'
  | 'key_rotated'
  | 'ai_privacy_updated'
  | 'account_deleted'
  | 'security_warning';

export interface SecuritySessionRecord {
  id: string;
  ownerId: string;
  deviceLabel: string;
  browserSummary: string;
  revoked: boolean;
  lastActiveAt: string;
  createdAt?: string;
}

export interface PrivacySettingsRecord {
  id: 'config';
  ownerId: string;
  aiAnalysisPaused: boolean;
  gmailSyncPaused: boolean;
  calendarSyncPaused: boolean;
  keyVersion: number;
}

export interface AuditLogRecord {
  id: string;
  ownerId: string;
  eventType: AuditEventType;
  summary: string;
  severity: 'info' | 'warning' | 'critical';
  deviceLabel: string;
  createdAt: string;
}

