import { auth } from '../firebase';
import type {
  BrainQueryResponse,
  CheckInResponse,
  ChatTurn,
  ConnectImportMethod,
  ConnectPlatformId,
  ConversationAnalysisResult,
  DailyBriefingResponse,
  DetectedResponseCandidate,
  GmailMessageSummary,
  ParseInputResponse,
  ReminderItem,
  SnoozeCheckResponse,
  UpdateSummaryResponse,
  UserProfile,
} from '../types/reminder';

let clientAiPausedOverride = false;

export function setClientAiAnalysisPaused(paused: boolean): void {
  clientAiPausedOverride = Boolean(paused);
}

export function isClientAiAnalysisPaused(): boolean {
  return clientAiPausedOverride;
}

async function getVerifiedAuthHeaders(): Promise<Record<string, string>> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Sign in with Google to use Oopsie AI features.');
  }
  const idToken = await currentUser.getIdToken();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${idToken}`,
    ...(clientAiPausedOverride ? { 'X-Oopsie-AI-Paused': 'true' } : {}),
  };
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 40000): Promise<T> {
  const maxAttempts = 2;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = await getVerifiedAuthHeaders();
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 503 && data?.code === 'SERVICE_UNAVAILABLE' && attempt === 0) {
          await new Promise((r) => window.setTimeout(r, 1200));
          continue;
        }
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      return data as T;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error('Oopsie took a little too long to reply—hit Retry to continue right here.');
      }
      throw err;
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw new Error('Oopsie could not reach the assistant right now.');
}

function readHeaderSampleBase64(file: File): Promise<string> {
  return new Promise((resolve) => {
    const slice = file.slice(0, 64);
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      resolve(res.includes(',') ? res.split(',').pop() || '' : '');
    };
    reader.onerror = () => resolve('');
    reader.readAsDataURL(slice);
  });
}

export async function validateConnectUploadFile(params: {
  file: File;
  kind: 'text' | 'audio';
  textPreview?: string;
}): Promise<{ ok: boolean; safeFileName: string }> {
  // Always enforce baseline client checks first (works in guest mode too), then server check when signed in
  const rawName = params.file.name || '';
  if (
    !rawName ||
    rawName.length > 180 ||
    rawName.includes('..') ||
    rawName.includes('/') ||
    rawName.includes('\\')
  ) {
    throw new Error('File name contains disallowed path characters.');
  }

  const headerSampleBase64 = await readHeaderSampleBase64(params.file);

  if (auth.currentUser) {
    return postJson<{ ok: boolean; safeFileName: string }>('/api/connect/validate-file', {
      fileName: rawName,
      kind: params.kind,
      sizeBytes: params.file.size,
      headerSampleBase64,
      textPreview: params.textPreview?.slice(0, 4000),
    });
  }

  return { ok: true, safeFileName: rawName };
}

export function parseNaturalInput(params: {
  input: string;
  userProfile: UserProfile;
  existingItems?: ReminderItem[];
  conversationHistory?: ChatTurn[];
}): Promise<ParseInputResponse> {
  const compactExisting = (params.existingItems || []).slice(0, 25).map((it) => ({
    id: it.id,
    title: it.title,
    person: it.person,
    status: it.status,
    dueAt: it.dueAt,
    lastNote: it.timeline.length > 0 ? it.timeline[it.timeline.length - 1].text : null,
  }));

  const recentHistory = (params.conversationHistory ?? []).slice(-10);

  return postJson<ParseInputResponse>('/api/assistant/parse', {
    input: params.input,
    nowIso: new Date().toISOString(),
    timezone: params.userProfile.timezone,
    userProfile: params.userProfile,
    existingItems: compactExisting,
    conversationHistory: recentHistory,
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function generateCheckInQuestion(
  item: ReminderItem,
  userProfile: UserProfile
): Promise<CheckInResponse> {
  return postJson<CheckInResponse>('/api/assistant/checkin', {
    item,
    userProfile,
    nowIso: new Date().toISOString(),
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function submitFollowUpUpdate(params: {
  item: ReminderItem;
  userReply: string;
  userProfile: UserProfile;
}): Promise<UpdateSummaryResponse> {
  return postJson<UpdateSummaryResponse>('/api/assistant/update', {
    item: params.item,
    userReply: params.userReply,
    nowIso: new Date().toISOString(),
    timezone: params.userProfile.timezone,
    userProfile: params.userProfile,
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function querySecondBrain(params: {
  query: string;
  items: ReminderItem[];
  userProfile: UserProfile;
}): Promise<BrainQueryResponse> {
  return postJson<BrainQueryResponse>('/api/assistant/brain', {
    query: params.query,
    items: params.items,
    userProfile: params.userProfile,
    nowIso: new Date().toISOString(),
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function fetchDailyBriefing(params: {
  items: ReminderItem[];
  userProfile: UserProfile;
}): Promise<DailyBriefingResponse> {
  return postJson<DailyBriefingResponse>('/api/assistant/briefing', {
    items: params.items,
    userProfile: params.userProfile,
    nowIso: new Date().toISOString(),
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function checkRepeatedSnooze(
  item: ReminderItem,
  userProfile: UserProfile
): Promise<SnoozeCheckResponse> {
  return postJson<SnoozeCheckResponse>('/api/assistant/snooze-check', {
    item,
    userProfile,
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function transcribeConnectAudio(params: {
  audioBase64: string;
  mimeType: string;
}): Promise<{ transcript: string }> {
  return postJson<{ transcript: string }>(
    '/api/connect/transcribe',
    { ...params, aiAnalysisPaused: clientAiPausedOverride },
    45000
  );
}

export function analyzeConnectConversation(params: {
  rawText: string;
  platform: ConnectPlatformId;
  method: ConnectImportMethod;
  userProfile: UserProfile;
  existingPeople: string[];
  existingItems: ReminderItem[];
}): Promise<ConversationAnalysisResult> {
  const compactItems = params.existingItems
    .filter((i) => i.status !== 'closed')
    .slice(0, 20)
    .map((i) => ({
      id: i.id,
      title: i.title,
      person: i.person,
      dueAt: i.dueAt,
      status: i.status,
    }));

  return postJson<ConversationAnalysisResult>('/api/connect/analyze', {
    rawText: params.rawText,
    platform: params.platform,
    method: params.method,
    userProfile: params.userProfile,
    existingPeople: params.existingPeople,
    existingItems: compactItems,
    nowIso: new Date().toISOString(),
    timezone: params.userProfile.timezone,
    aiAnalysisPaused: clientAiPausedOverride,
  });
}

export function detectConnectResponses(params: {
  messages: GmailMessageSummary[];
  activeItems: ReminderItem[];
  userProfile: UserProfile;
}): Promise<{ candidates: DetectedResponseCandidate[] }> {
  return postJson<{ candidates: DetectedResponseCandidate[] }>(
    '/api/connect/detect-responses',
    {
      messages: params.messages.slice(0, 15),
      activeItems: params.activeItems
        .filter((it) => it.status !== 'closed')
        .slice(0, 25)
        .map((it) => ({
          id: it.id,
          title: it.title,
          person: it.person,
          status: it.status,
          dueAt: it.dueAt,
          followUpRule: it.followUpRule,
        })),
      userProfile: params.userProfile,
      nowIso: new Date().toISOString(),
      aiAnalysisPaused: clientAiPausedOverride,
    }
  );
}
