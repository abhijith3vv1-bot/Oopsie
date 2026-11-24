import type {
  CalendarEventSummary,
  ConnectDuplicateMatch,
  ConnectIntegrationState,
  ConnectPersonCandidate,
  ConnectPlatformId,
  ContactProfile,
  DetectedResponseCandidate,
  GmailMessageSummary,
  ImportedConversationRecord,
  ReminderItem,
} from '../types/reminder';
import { normalizePersonKey } from './contacts';
import { decryptVaultJson, encryptVaultJson, wipeConnectVaultKey } from './cryptoVault';

const CONVERSATIONS_VAULT_KEY = 'oopsie_connect_conversations_vault_v1';
const INTEGRATIONS_KEY = 'oopsie_connect_integrations_v1';
const RESPONSES_VAULT_KEY = 'oopsie_connect_responses_vault_v1';

export interface ConnectPlatformMeta {
  id: ConnectPlatformId;
  name: string;
  tagline: string;
  methodLabel: string;
  supportsAutoSync: boolean;
  supportsResponseDetection: boolean;
}

export const CONNECT_PLATFORMS: ConnectPlatformMeta[] = [
  {
    id: 'gmail',
    name: 'Gmail',
    tagline: 'Import email threads & detect incoming replies.',
    methodLabel: 'Official Read-Only Gmail API',
    supportsAutoSync: true,
    supportsResponseDetection: true,
  },
  {
    id: 'google_calendar',
    name: 'Google Calendar',
    tagline: 'Turn meetings & attendees into follow-up commitments.',
    methodLabel: 'Official Read-Only Calendar API',
    supportsAutoSync: true,
    supportsResponseDetection: false,
  },
  {
    id: 'whatsapp',
    name: 'WhatsApp',
    tagline: 'Bring in chat threads via export, Share sheet, or paste.',
    methodLabel: 'Exported .txt · Share Sheet · Paste',
    supportsAutoSync: false,
    supportsResponseDetection: false,
  },
  {
    id: 'phone',
    name: 'Phone Calls',
    tagline: 'Record voice summaries or upload call audio & transcripts.',
    methodLabel: 'Voice Recording · Audio File · Transcript',
    supportsAutoSync: false,
    supportsResponseDetection: false,
  },
  {
    id: 'instagram',
    name: 'Instagram',
    tagline: 'Capture commitments from DM threads or shared messages.',
    methodLabel: 'Share Sheet · Paste DM · Exported File',
    supportsAutoSync: false,
    supportsResponseDetection: false,
  },
  {
    id: 'telegram',
    name: 'Telegram',
    tagline: 'Analyze Telegram JSON exports or forwarded chat text.',
    methodLabel: 'Exported JSON · Share Sheet · Paste',
    supportsAutoSync: false,
    supportsResponseDetection: false,
  },
];

export function getDefaultIntegrationsMap(): Record<ConnectPlatformId, ConnectIntegrationState> {
  return {
    gmail: {
      platform: 'gmail',
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
      permissionGrantedAt: null,
      lastImportedAt: null,
    },
    google_calendar: {
      platform: 'google_calendar',
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
      permissionGrantedAt: null,
      lastImportedAt: null,
    },
    whatsapp: {
      platform: 'whatsapp',
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
      permissionGrantedAt: null,
      lastImportedAt: null,
    },
    phone: {
      platform: 'phone',
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
      permissionGrantedAt: null,
      lastImportedAt: null,
    },
    instagram: {
      platform: 'instagram',
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
      permissionGrantedAt: null,
      lastImportedAt: null,
    },
    telegram: {
      platform: 'telegram',
      connected: false,
      connectedEmail: null,
      lastSyncedAt: null,
      permissionGrantedAt: null,
      lastImportedAt: null,
    },
  };
}

export function loadIntegrationsMap(): Record<ConnectPlatformId, ConnectIntegrationState> {
  const defaults = getDefaultIntegrationsMap();
  try {
    const raw = localStorage.getItem(INTEGRATIONS_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<
      Record<ConnectPlatformId, Partial<ConnectIntegrationState>>
    >;
    const next = { ...defaults };
    for (const id of Object.keys(defaults) as ConnectPlatformId[]) {
      if (parsed?.[id]) {
        next[id] = { ...defaults[id], ...parsed[id], platform: id };
      }
    }
    return next;
  } catch {
    return defaults;
  }
}

export function saveIntegrationsMap(
  map: Record<ConnectPlatformId, ConnectIntegrationState>
): void {
  try {
    localStorage.setItem(INTEGRATIONS_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage quota issues
  }
}

export async function loadEncryptedConversations(): Promise<ImportedConversationRecord[]> {
  try {
    const raw = localStorage.getItem(CONVERSATIONS_VAULT_KEY);
    const list = await decryptVaultJson<ImportedConversationRecord[]>(raw, []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveEncryptedConversations(
  records: ImportedConversationRecord[]
): Promise<void> {
  const cipher = await encryptVaultJson(records);
  localStorage.setItem(CONVERSATIONS_VAULT_KEY, cipher);
}

export async function loadEncryptedDetectedResponses(): Promise<DetectedResponseCandidate[]> {
  try {
    const raw = localStorage.getItem(RESPONSES_VAULT_KEY);
    const list = await decryptVaultJson<DetectedResponseCandidate[]>(raw, []);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveEncryptedDetectedResponses(
  candidates: DetectedResponseCandidate[]
): Promise<void> {
  const cipher = await encryptVaultJson(candidates);
  localStorage.setItem(RESPONSES_VAULT_KEY, cipher);
}

export async function purgeAllConnectData(): Promise<void> {
  try {
    localStorage.removeItem(CONVERSATIONS_VAULT_KEY);
    localStorage.removeItem(INTEGRATIONS_KEY);
    localStorage.removeItem(RESPONSES_VAULT_KEY);
  } catch {
    // Ignore
  }
  await wipeConnectVaultKey();
}

export interface ParsedExportFile {
  cleanText: string;
  detectedPlatform?: ConnectPlatformId;
  summaryNote: string;
}

function flattenTelegramText(textField: unknown): string {
  if (typeof textField === 'string') return textField;
  if (Array.isArray(textField)) {
    return textField
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '');
        }
        return '';
      })
      .join('');
  }
  return '';
}

export function parseExportedConversationFile(
  fileName: string,
  rawText: string
): ParsedExportFile {
  const lowerName = fileName.toLowerCase();
  const trimmed = rawText.trim();

  // 1. Telegram JSON export (result.json)
  if (lowerName.endsWith('.json') || trimmed.startsWith('{')) {
    try {
      const json = JSON.parse(trimmed) as {
        name?: string;
        type?: string;
        messages?: Array<{
          type?: string;
          date?: string;
          from?: string;
          text?: unknown;
        }>;
      };
      if (Array.isArray(json?.messages)) {
        const lines = json.messages
          .filter((m) => (!m.type || m.type === 'message') && flattenTelegramText(m.text).trim())
          .slice(-80)
          .map((m) => {
            const datePart = m.date ? m.date.slice(0, 16).replace('T', ' ') : '';
            const speaker = m.from || 'Participant';
            const body = flattenTelegramText(m.text).trim();
            return `[${datePart}] ${speaker}: ${body}`;
          });
        const header = json.name ? `Telegram Chat: ${json.name}\n` : '';
        return {
          cleanText: `${header}${lines.join('\n')}`.slice(-14000),
          detectedPlatform: 'telegram',
          summaryNote: `Parsed ${lines.length} Telegram messages from ${fileName}`,
        };
      }
    } catch {
      // Fall through to plain text handling
    }
  }

  // 2. Email (.eml)
  if (lowerName.endsWith('.eml') || (/^From:\s/im.test(trimmed) && /^Subject:\s/im.test(trimmed))) {
    const splitIdx = trimmed.search(/\r?\n\r?\n/);
    const headers = splitIdx !== -1 ? trimmed.slice(0, splitIdx) : trimmed.slice(0, 800);
    const bodyRaw = splitIdx !== -1 ? trimmed.slice(splitIdx + 2) : trimmed;
    const fromMatch = headers.match(/^From:\s*(.+)$/im);
    const subjectMatch = headers.match(/^Subject:\s*(.+)$/im);
    const dateMatch = headers.match(/^Date:\s*(.+)$/im);

    const strippedBody = bodyRaw
      .replace(/--[A-Za-z0-9._-]+--?/g, '\n')
      .replace(/Content-[A-Za-z-]+:[^\n]*\n/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    const formatted = [
      fromMatch ? `From: ${fromMatch[1].trim()}` : '',
      subjectMatch ? `Subject: ${subjectMatch[1].trim()}` : '',
      dateMatch ? `Date: ${dateMatch[1].trim()}` : '',
      '',
      strippedBody,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      cleanText: formatted.slice(0, 14000),
      detectedPlatform: 'gmail',
      summaryNote: `Parsed email export ${fileName}`,
    };
  }

  // 3. WhatsApp chat export (.txt)
  const waPattern =
    /^(?:\[?\d{1,4}[\/.-]\d{1,2}[\/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[APap][Mm])?\]?\s*-?\s*)([^:\n]+):\s*(.+)$/gm;
  const waMatches = Array.from(trimmed.matchAll(waPattern));
  if (waMatches.length >= 2) {
    const recentLines = trimmed.split(/\r?\n/).slice(-120).join('\n');
    return {
      cleanText: recentLines.slice(-14000),
      detectedPlatform: 'whatsapp',
      summaryNote: `Parsed WhatsApp chat export (${waMatches.length} messages)`,
    };
  }

  // 4. SRT / VTT transcript cleanup
  if (lowerName.endsWith('.srt') || lowerName.endsWith('.vtt')) {
    const cleaned = trimmed
      .replace(/^WEBVTT.*$/gm, '')
      .replace(/^\d+$/gm, '')
      .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    return {
      cleanText: cleaned.slice(-14000),
      detectedPlatform: 'phone',
      summaryNote: `Cleaned transcript from ${fileName}`,
    };
  }

  // 5. Generic text / CSV
  return {
    cleanText: trimmed.slice(-14000),
    summaryNote: `Loaded ${fileName} (${Math.min(trimmed.length, 14000).toLocaleString()} chars)`,
  };
}

export function findContactMatches(
  personName: string | null,
  contactsMap: Record<string, ContactProfile>,
  items: ReminderItem[]
): ConnectPersonCandidate[] {
  if (!personName?.trim()) return [];
  const raw = personName.trim();
  const norm = normalizePersonKey(raw);
  const tokens = norm.split(' ').filter((t) => t.length >= 2);

  const knownPeople = new Map<string, string>();
  for (const c of Object.values(contactsMap)) {
    knownPeople.set(c.key, c.name);
  }
  for (const it of items) {
    if (it.person?.trim()) {
      const k = normalizePersonKey(it.person);
      if (!knownPeople.has(k)) knownPeople.set(k, it.person.trim());
    }
  }

  const candidates: ConnectPersonCandidate[] = [];
  for (const [key, name] of knownPeople.entries()) {
    if (key === norm) {
      candidates.unshift({
        key,
        name,
        reason: 'Exact contact match',
      });
      continue;
    }

    const nameTokens = key.split(' ').filter((t) => t.length >= 2);
    const shared = tokens.filter((t) =>
      nameTokens.some((nt) => nt === t || (t.length >= 3 && (nt.startsWith(t) || t.startsWith(nt))))
    );

    if (key.includes(norm) || norm.includes(key) || shared.length > 0) {
      candidates.push({
        key,
        name,
        reason: 'Similar name in your Contacts',
      });
    }
  }

  return candidates.slice(0, 5);
}

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'about',
  'follow',
  'followup',
  'check',
  'send',
  'remind',
  'regarding',
  'update',
  'call',
  'email',
]);

export function findDuplicateReminders(
  person: string | null,
  topic: string,
  items: ReminderItem[]
): ConnectDuplicateMatch[] {
  const normPerson = person ? normalizePersonKey(person) : '';
  const topicWords = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP_WORDS.has(w));

  const matches: ConnectDuplicateMatch[] = [];
  for (const item of items) {
    if (item.status === 'closed') continue;
    const itemPerson = item.person ? normalizePersonKey(item.person) : '';
    const samePerson = Boolean(
      normPerson &&
        itemPerson &&
        (itemPerson === normPerson ||
          itemPerson.includes(normPerson) ||
          normPerson.includes(itemPerson))
    );

    const haystack = `${item.title} ${item.followUpRule.description || ''}`.toLowerCase();
    const overlappingWords = topicWords.filter((w) => haystack.includes(w));

    if ((samePerson && overlappingWords.length >= 1) || overlappingWords.length >= 2) {
      matches.push({
        itemId: item.id,
        title: item.title,
        person: item.person,
        dueAt: item.dueAt,
        status: item.status,
        reason: samePerson
          ? `Active follow-up with ${item.person} on a similar topic`
          : 'Active reminder with matching keywords',
      });
    }
  }

  return matches.slice(0, 3);
}

function decodeBase64Url(input: string): string {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

interface GmailPayloadPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPart[];
}

function extractPlainTextFromGmailPayload(payload?: GmailPayloadPart): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      const found = extractPlainTextFromGmailPayload(part);
      if (found.trim()) return found;
    }
    for (const part of payload.parts) {
      if (part.mimeType === 'text/html' && part.body?.data) {
        const html = decodeBase64Url(part.body.data);
        return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      }
    }
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data)
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return '';
}

function parseFromHeader(rawFrom: string): { name: string; email: string } {
  const angleMatch = rawFrom.match(/^(.*?)\s*<([^>]+)>$/);
  if (angleMatch) {
    const cleanName = angleMatch[1].replace(/^"|"$/g, '').trim();
    const email = angleMatch[2].trim();
    return {
      name: cleanName || email.split('@')[0],
      email,
    };
  }
  const emailOnly = rawFrom.trim();
  return {
    name: emailOnly.includes('@') ? emailOnly.split('@')[0] : emailOnly,
    email: emailOnly,
  };
}

export async function fetchGmailMessages(
  accessToken: string,
  maxResults = 12
): Promise<GmailMessageSummary[]> {
  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(
    '-category:promotions -category:social'
  )}`;

  const listRes = await fetch(listUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (listRes.status === 401 || listRes.status === 403) {
    throw new Error('GMAIL_AUTH_EXPIRED');
  }
  if (!listRes.ok) {
    throw new Error(`Gmail API error (${listRes.status})`);
  }

  const listJson = (await listRes.json()) as { messages?: Array<{ id: string; threadId: string }> };
  const stubs = listJson.messages || [];
  if (stubs.length === 0) return [];

  const details = await Promise.all(
    stubs.slice(0, maxResults).map(async (stub) => {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
          stub.id
        )}?format=full`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      );
      if (!msgRes.ok) return null;
      const msg = (await msgRes.json()) as {
        id: string;
        threadId: string;
        snippet?: string;
        internalDate?: string;
        payload?: GmailPayloadPart & {
          headers?: Array<{ name: string; value: string }>;
        };
      };
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

      const rawFrom = getHeader('From') || 'Unknown sender';
      const parsedFrom = parseFromHeader(rawFrom);
      const subject = getHeader('Subject') || '(No subject)';
      const dateHeader = getHeader('Date');
      const dateIso = dateHeader
        ? new Date(dateHeader).toISOString()
        : msg.internalDate
          ? new Date(Number(msg.internalDate)).toISOString()
          : new Date().toISOString();

      const bodyText =
        extractPlainTextFromGmailPayload(msg.payload).slice(0, 6000) || msg.snippet || '';

      return {
        id: msg.id,
        threadId: msg.threadId,
        from: rawFrom,
        fromName: parsedFrom.name,
        fromEmail: parsedFrom.email,
        subject,
        date: Number.isNaN(new Date(dateIso).getTime()) ? new Date().toISOString() : dateIso,
        snippet: msg.snippet || bodyText.slice(0, 160),
        bodyText,
      } satisfies GmailMessageSummary;
    })
  );

  return details.filter((m): m is GmailMessageSummary => m !== null);
}

export async function fetchGoogleCalendarEvents(
  accessToken: string,
  maxResults = 15
): Promise<CalendarEventSummary[]> {
  const now = Date.now();
  const timeMin = new Date(now - 7 * 86400000).toISOString();
  const timeMax = new Date(now + 14 * 86400000).toISOString();

  const url =
    `https://www.googleapis.com/calendar/v3/calendars/primary/events` +
    `?maxResults=${maxResults}&singleEvents=true&orderBy=startTime` +
    `&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status === 401 || res.status === 403) {
    throw new Error('CALENDAR_AUTH_EXPIRED');
  }
  if (!res.ok) {
    throw new Error(`Google Calendar API error (${res.status})`);
  }

  const data = (await res.json()) as {
    items?: Array<{
      id: string;
      summary?: string;
      description?: string;
      location?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      organizer?: { displayName?: string; email?: string };
      attendees?: Array<{
        displayName?: string;
        email?: string;
        self?: boolean;
        responseStatus?: string;
      }>;
    }>;
  };

  return (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || '(Untitled meeting)',
    description: (ev.description || '').replace(/<[^>]+>/g, ' ').trim(),
    startIso: ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T09:00:00Z` : new Date().toISOString()),
    endIso: ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T10:00:00Z` : new Date().toISOString()),
    organizer: ev.organizer?.displayName || ev.organizer?.email || null,
    attendees: (ev.attendees || [])
      .filter((a) => !a.self && a.email)
      .map((a) => ({
        name: a.displayName || null,
        email: a.email || '',
        responseStatus: a.responseStatus,
      })),
    location: ev.location || null,
  }));
}
