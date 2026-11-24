import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Timestamp,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AlarmIntensity,
  AlarmToneId,
  AuditEventType,
  AuditLogRecord,
  ContactProfile,
  PrivacySettingsRecord,
  ReminderCategory,
  ReminderItem,
  ReminderPriority,
  ReminderStatus,
  ReminderStyle,
  SecuritySessionRecord,
  TimelineEntry,
  UserProfile,
} from '../types/reminder';
import { decryptVaultJson, encryptVaultJson, getLocalVaultKeyVersion } from './cryptoVault';
import { getDefaultProfile } from './storage';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

const VALID_CATEGORIES = new Set<ReminderCategory>([
  'Work',
  'Personal',
  'Finance',
  'Health',
  'Errands',
  'Social',
]);
const VALID_PRIORITIES = new Set<ReminderPriority>(['low', 'medium', 'high']);
const VALID_STATUSES = new Set<ReminderStatus>(['needs_action', 'waiting', 'closed']);
const VALID_TONES = new Set<AlarmToneId>([
  'bubble_pop',
  'little_bell',
  'sleepy_chime',
  'oopsie_giggle',
]);

function safeId(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 128);
  return cleaned || crypto.randomUUID();
}

function clampString(val: string | null | undefined, maxLen: number): string | null {
  if (val == null) return null;
  const s = String(val).trim();
  return s ? s.slice(0, maxLen) : null;
}

function sanitizeTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return (Array.isArray(entries) ? entries : []).slice(-200).map((entry) => {
    const clean: TimelineEntry = {
      id: safeId(String(entry.id || crypto.randomUUID())),
      type: entry.type || 'user_update',
      text: String(entry.text || '').slice(0, 2000),
      timestamp: String(entry.timestamp || new Date().toISOString()).slice(0, 64),
    };
    if (entry.meta && (entry.meta.nextFollowUpAt || entry.meta.snoozeMinutes !== undefined)) {
      clean.meta = {
        ...(entry.meta.nextFollowUpAt
          ? { nextFollowUpAt: String(entry.meta.nextFollowUpAt).slice(0, 64) }
          : {}),
        ...(entry.meta.snoozeMinutes !== undefined
          ? { snoozeMinutes: Math.max(0, Math.round(Number(entry.meta.snoozeMinutes) || 0)) }
          : {}),
      };
    }
    return clean;
  });
}

function buildUserProfileWriteData(
  uid: string,
  email: string | null,
  profile: UserProfile,
  isCreate: boolean
) {
  const defaults = getDefaultProfile();
  const base: Record<string, unknown> = {
    ownerId: safeId(uid),
    name: String(profile.name || '').trim().slice(0, 80),
    ...(email ? { email: email.slice(0, 160) } : {}),
    reminderStyle: (profile.reminderStyle === 'firm' ? 'firm' : 'gentle') as ReminderStyle,
    wakeTime: /^\d{2}:\d{2}$/.test(profile.wakeTime) ? profile.wakeTime : defaults.wakeTime,
    sleepTime: /^\d{2}:\d{2}$/.test(profile.sleepTime) ? profile.sleepTime : defaults.sleepTime,
    timezone: String(profile.timezone || defaults.timezone).slice(0, 64),
    theme: profile.theme === 'dark' ? 'dark' : 'light',
    soundEnabled: Boolean(profile.soundEnabled),
    alarmTone: VALID_TONES.has(profile.alarmTone) ? profile.alarmTone : 'bubble_pop',
    alarmVolume: Math.max(0, Math.min(1, Number(profile.alarmVolume ?? 0.8))),
    alarmIntensity: (profile.alarmIntensity === 'firm' ? 'firm' : 'gentle') as AlarmIntensity,
    audioUnlocked: Boolean(profile.audioUnlocked),
    onboardingComplete: Boolean(profile.onboardingComplete),
    streakDays: Math.max(0, Math.min(100000, Math.round(Number(profile.streakDays || 0)))),
    lastClosedDate: clampString(profile.lastClosedDate, 20),
    closedCountTotal: Math.max(0, Math.min(1000000, Math.round(Number(profile.closedCountTotal || 0)))),
    lastBriefingDate: clampString(profile.lastBriefingDate, 20),
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    base.createdAt = serverTimestamp();
  }
  return base;
}

function buildReminderWriteData(uid: string, item: ReminderItem, isCreate: boolean) {
  const safeCategory = VALID_CATEGORIES.has(item.category) ? item.category : 'Personal';
  const safePriority = VALID_PRIORITIES.has(item.priority) ? item.priority : 'medium';
  const safeStatus = VALID_STATUSES.has(item.status) ? item.status : 'needs_action';
  const intervalRaw = item.followUpRule?.intervalDays;
  const cleanInterval =
    typeof intervalRaw === 'number' && !Number.isNaN(intervalRaw)
      ? Math.max(0, Math.min(3650, intervalRaw))
      : null;

  const data: Record<string, unknown> = {
    title: (String(item.title || 'Untitled reminder').trim() || 'Untitled reminder').slice(0, 280),
    person: clampString(item.person, 120),
    project: clampString(item.project, 120),
    category: safeCategory,
    priority: safePriority,
    dueAt: String(item.dueAt || new Date().toISOString()).slice(0, 64),
    status: safeStatus,
    followUpRule: {
      enabled: Boolean(item.followUpRule?.enabled),
      intervalDays: cleanInterval,
      description: clampString(item.followUpRule?.description, 200),
    },
    snoozeCount: Math.max(0, Math.min(10000, Math.round(Number(item.snoozeCount || 0)))),
    lastNotifiedAt: clampString(item.lastNotifiedAt, 64),
    lastActivityAt: String(item.lastActivityAt || new Date().toISOString()).slice(0, 64),
    closedAt: clampString(item.closedAt, 64),
    timeline: sanitizeTimeline(item.timeline),
    updatedAt: serverTimestamp(),
  };

  if (isCreate) {
    data.id = safeId(item.id);
    data.ownerId = safeId(uid);
    data.reminderCreatedAt = String(item.createdAt || new Date().toISOString()).slice(0, 64);
    data.createdAt = serverTimestamp();
  }

  return data;
}

function docToUserProfile(data: Record<string, unknown>): UserProfile {
  const defaults = getDefaultProfile();
  return {
    ...defaults,
    name: typeof data.name === 'string' ? data.name : defaults.name,
    reminderStyle: data.reminderStyle === 'firm' ? 'firm' : 'gentle',
    wakeTime: typeof data.wakeTime === 'string' ? data.wakeTime : defaults.wakeTime,
    sleepTime: typeof data.sleepTime === 'string' ? data.sleepTime : defaults.sleepTime,
    timezone: typeof data.timezone === 'string' ? data.timezone : defaults.timezone,
    theme: data.theme === 'dark' ? 'dark' : 'light',
    soundEnabled: typeof data.soundEnabled === 'boolean' ? data.soundEnabled : defaults.soundEnabled,
    alarmTone: VALID_TONES.has(data.alarmTone as AlarmToneId)
      ? (data.alarmTone as AlarmToneId)
      : defaults.alarmTone,
    alarmVolume:
      typeof data.alarmVolume === 'number' ? data.alarmVolume : defaults.alarmVolume,
    alarmIntensity: data.alarmIntensity === 'firm' ? 'firm' : 'gentle',
    audioUnlocked: Boolean(data.audioUnlocked),
    onboardingComplete: Boolean(data.onboardingComplete),
    streakDays: typeof data.streakDays === 'number' ? data.streakDays : 0,
    lastClosedDate: typeof data.lastClosedDate === 'string' ? data.lastClosedDate : null,
    closedCountTotal: typeof data.closedCountTotal === 'number' ? data.closedCountTotal : 0,
    lastBriefingDate: typeof data.lastBriefingDate === 'string' ? data.lastBriefingDate : null,
  };
}

function docToReminderItem(docId: string, data: Record<string, unknown>): ReminderItem {
  const rawRule = (data.followUpRule as Record<string, unknown> | undefined) || {};
  const createdTs = data.createdAt as Timestamp | undefined;
  const fallbackCreated =
    typeof data.reminderCreatedAt === 'string'
      ? data.reminderCreatedAt
      : createdTs && typeof createdTs.toDate === 'function'
        ? createdTs.toDate().toISOString()
        : new Date().toISOString();

  return {
    id: typeof data.id === 'string' ? data.id : docId,
    title: typeof data.title === 'string' ? data.title : 'Untitled reminder',
    person: typeof data.person === 'string' ? data.person : null,
    project: typeof data.project === 'string' ? data.project : null,
    category: VALID_CATEGORIES.has(data.category as ReminderCategory)
      ? (data.category as ReminderCategory)
      : 'Personal',
    priority: VALID_PRIORITIES.has(data.priority as ReminderPriority)
      ? (data.priority as ReminderPriority)
      : 'medium',
    dueAt: typeof data.dueAt === 'string' ? data.dueAt : new Date().toISOString(),
    status: VALID_STATUSES.has(data.status as ReminderStatus)
      ? (data.status as ReminderStatus)
      : 'needs_action',
    followUpRule: {
      enabled: Boolean(rawRule.enabled),
      intervalDays: typeof rawRule.intervalDays === 'number' ? rawRule.intervalDays : null,
      description: typeof rawRule.description === 'string' ? rawRule.description : null,
    },
    snoozeCount: typeof data.snoozeCount === 'number' ? data.snoozeCount : 0,
    lastNotifiedAt: typeof data.lastNotifiedAt === 'string' ? data.lastNotifiedAt : null,
    lastActivityAt: typeof data.lastActivityAt === 'string' ? data.lastActivityAt : fallbackCreated,
    createdAt: fallbackCreated,
    closedAt: typeof data.closedAt === 'string' ? data.closedAt : null,
    timeline: Array.isArray(data.timeline) ? (data.timeline as TimelineEntry[]) : [],
  };
}

export async function ensureUserProfileDoc(
  uid: string,
  email: string | null,
  displayName: string | null,
  localProfile: UserProfile
): Promise<UserProfile> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      return docToUserProfile(snap.data() as Record<string, unknown>);
    }

    const seededProfile: UserProfile = {
      ...localProfile,
      name: localProfile.name.trim() || (displayName ? displayName.split(' ')[0] : ''),
    };
    await setDoc(ref, buildUserProfileWriteData(uid, email, seededProfile, true));
    return seededProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function upsertCloudProfile(
  uid: string,
  email: string | null,
  profile: UserProfile
): Promise<void> {
  const path = `users/${uid}`;
  const ref = doc(db, 'users', uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, buildUserProfileWriteData(uid, email, profile, false));
    } else {
      await setDoc(ref, buildUserProfileWriteData(uid, email, profile, true));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function migrateLocalRemindersToCloud(
  uid: string,
  localItems: ReminderItem[]
): Promise<void> {
  if (localItems.length === 0) return;
  const colPath = `users/${uid}/reminders`;

  let existingIds = new Set<string>();
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    existingIds = new Set(snap.docs.map((d) => d.id));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }

  for (const item of localItems) {
    const id = safeId(item.id);
    if (existingIds.has(id)) continue;
    const itemPath = `${colPath}/${id}`;
    try {
      await setDoc(doc(db, colPath, id), buildReminderWriteData(uid, { ...item, id }, true));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, itemPath);
    }
  }
}

export async function createCloudReminders(
  uid: string,
  email: string | null,
  profile: UserProfile,
  itemsToCreate: ReminderItem[]
): Promise<void> {
  if (itemsToCreate.length === 0) return;
  await ensureUserProfileDoc(uid, email, profile.name, profile);

  const colPath = `users/${uid}/reminders`;
  for (const item of itemsToCreate) {
    const id = safeId(item.id);
    const itemPath = `${colPath}/${id}`;
    try {
      await setDoc(doc(db, colPath, id), buildReminderWriteData(uid, { ...item, id }, true));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, itemPath);
    }
  }
}

export async function saveCloudReminder(
  uid: string,
  item: ReminderItem
): Promise<void> {
  const id = safeId(item.id);
  const itemPath = `users/${uid}/reminders/${id}`;
  const ref = doc(db, 'users', uid, 'reminders', id);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, buildReminderWriteData(uid, { ...item, id }, false));
    } else {
      await setDoc(ref, buildReminderWriteData(uid, { ...item, id }, true));
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, itemPath);
  }
}

export async function deleteCloudReminder(uid: string, itemId: string): Promise<void> {
  const id = safeId(itemId);
  const itemPath = `users/${uid}/reminders/${id}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'reminders', id));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, itemPath);
  }
}

export async function clearCloudReminders(uid: string): Promise<void> {
  const colPath = `users/${uid}/reminders`;
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, colPath);
  }
}

export function subscribeToUserWorkspace(
  uid: string,
  handlers: {
    onProfile: (profile: UserProfile) => void;
    onItems: (items: ReminderItem[]) => void;
    onError: (err: Error) => void;
  }
): Unsubscribe {
  const profilePath = `users/${uid}`;
  const unsubProfile = onSnapshot(
    doc(db, 'users', uid),
    (snap) => {
      if (snap.exists()) {
        handlers.onProfile(docToUserProfile(snap.data() as Record<string, unknown>));
      }
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, profilePath);
      } catch (wrapped) {
        handlers.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  const colPath = `users/${uid}/reminders`;
  const q = query(collection(db, colPath), where('ownerId', '==', uid));
  const unsubItems = onSnapshot(
    q,
    (snap) => {
      const nextItems = snap.docs.map((d) =>
        docToReminderItem(d.id, d.data() as Record<string, unknown>)
      );
      handlers.onItems(nextItems);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (wrapped) {
        handlers.onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  return () => {
    unsubProfile();
    unsubItems();
  };
}

export async function registerOrTouchSession(
  uid: string,
  sessionId: string,
  deviceLabel: string,
  browserSummary: string
): Promise<void> {
  const sId = safeId(sessionId);
  const path = `users/${uid}/sessions/${sId}`;
  const ref = doc(db, 'users', uid, 'sessions', sId);
  const nowIso = new Date().toISOString().slice(0, 64);

  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const existingData = snap.data() as Record<string, unknown>;
      await updateDoc(ref, {
        revoked: Boolean(existingData.revoked),
        lastActiveAt: nowIso,
        browserSummary: browserSummary.slice(0, 160),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: sId,
        ownerId: safeId(uid),
        deviceLabel: (deviceLabel.trim() || 'Web Browser').slice(0, 120),
        browserSummary: browserSummary.slice(0, 160),
        revoked: false,
        lastActiveAt: nowIso,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeToSessionStatus(
  uid: string,
  sessionId: string,
  onRevoked: () => void
): Unsubscribe {
  const sId = safeId(sessionId);
  const ref = doc(db, 'users', uid, 'sessions', sId);
  return onSnapshot(
    ref,
    (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Record<string, unknown>;
        if (data.revoked === true) {
          onRevoked();
        }
      }
    },
    () => {
      // Ignore transient listener errors while signing out
    }
  );
}

export async function listUserSessions(uid: string): Promise<SecuritySessionRecord[]> {
  const colPath = `users/${uid}/sessions`;
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const createdTs = data.createdAt as Timestamp | undefined;
        return {
          id: typeof data.id === 'string' ? data.id : d.id,
          ownerId: typeof data.ownerId === 'string' ? data.ownerId : uid,
          deviceLabel: typeof data.deviceLabel === 'string' ? data.deviceLabel : 'Web Browser',
          browserSummary: typeof data.browserSummary === 'string' ? data.browserSummary : '',
          revoked: Boolean(data.revoked),
          lastActiveAt:
            typeof data.lastActiveAt === 'string'
              ? data.lastActiveAt
              : new Date().toISOString(),
          createdAt:
            createdTs && typeof createdTs.toDate === 'function'
              ? createdTs.toDate().toISOString()
              : undefined,
        } satisfies SecuritySessionRecord;
      })
      .sort(
        (a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
      );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function revokeSession(uid: string, sessionId: string): Promise<void> {
  const sId = safeId(sessionId);
  const path = `users/${uid}/sessions/${sId}`;
  try {
    await updateDoc(doc(db, 'users', uid, 'sessions', sId), {
      revoked: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function revokeAllUserSessions(
  uid: string,
  includeSessionId?: string
): Promise<number> {
  const sessions = await listUserSessions(uid);
  let count = 0;
  for (const s of sessions) {
    if (s.revoked) continue;
    if (includeSessionId && s.id !== includeSessionId) {
      await revokeSession(uid, s.id);
      count++;
    } else if (!includeSessionId || s.id === includeSessionId) {
      await revokeSession(uid, s.id);
      count++;
    }
  }
  return count;
}

export async function loadOrCreatePrivacySettings(
  uid: string,
  fallbackKeyVersion = getLocalVaultKeyVersion()
): Promise<PrivacySettingsRecord> {
  const path = `users/${uid}/privacySettings/config`;
  const ref = doc(db, 'users', uid, 'privacySettings', 'config');
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      return {
        id: 'config',
        ownerId: safeId(uid),
        aiAnalysisPaused: Boolean(data.aiAnalysisPaused),
        gmailSyncPaused: Boolean(data.gmailSyncPaused),
        calendarSyncPaused: Boolean(data.calendarSyncPaused),
        keyVersion:
          typeof data.keyVersion === 'number' && data.keyVersion >= 1
            ? Math.round(data.keyVersion)
            : fallbackKeyVersion,
      };
    }

    const initial: PrivacySettingsRecord = {
      id: 'config',
      ownerId: safeId(uid),
      aiAnalysisPaused: false,
      gmailSyncPaused: false,
      calendarSyncPaused: false,
      keyVersion: Math.max(1, fallbackKeyVersion),
    };
    await setDoc(ref, {
      ...initial,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return initial;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function updatePrivacySettings(
  uid: string,
  patch: Partial<
    Pick<
      PrivacySettingsRecord,
      'aiAnalysisPaused' | 'gmailSyncPaused' | 'calendarSyncPaused' | 'keyVersion'
    >
  >
): Promise<PrivacySettingsRecord> {
  const current = await loadOrCreatePrivacySettings(uid);
  const next: PrivacySettingsRecord = {
    ...current,
    ...patch,
    id: 'config',
    ownerId: safeId(uid),
    keyVersion: Math.max(1, Math.min(100000, Math.round(patch.keyVersion ?? current.keyVersion))),
  };
  const path = `users/${uid}/privacySettings/config`;
  const ref = doc(db, 'users', uid, 'privacySettings', 'config');
  try {
    await updateDoc(ref, {
      aiAnalysisPaused: next.aiAnalysisPaused,
      gmailSyncPaused: next.gmailSyncPaused,
      calendarSyncPaused: next.calendarSyncPaused,
      keyVersion: next.keyVersion,
      updatedAt: serverTimestamp(),
    });
    return next;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function writeAuditLog(
  uid: string,
  eventType: AuditEventType,
  summary: string,
  severity: 'info' | 'warning' | 'critical' = 'info',
  deviceLabel = 'Web Browser'
): Promise<void> {
  const logId = safeId(`log_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`);
  // Never store tokens, secrets, or raw conversation text in audit logs
  const safeSummary =
    summary
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]')
      .replace(/ya29\.[A-Za-z0-9._-]+/gi, '[REDACTED_TOKEN]')
      .trim()
      .slice(0, 240) || eventType;

  try {
    await setDoc(doc(db, 'users', uid, 'auditLogs', logId), {
      id: logId,
      ownerId: safeId(uid),
      eventType,
      summary: safeSummary,
      severity,
      deviceLabel: (deviceLabel || 'Web Browser').slice(0, 120),
      createdAt: serverTimestamp(),
    });
  } catch {
    // Non-blocking audit logging should not crash user UI if offline
  }
}

export async function listAuditLogs(uid: string): Promise<AuditLogRecord[]> {
  const colPath = `users/${uid}/auditLogs`;
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const ts = data.createdAt as Timestamp | undefined;
        const createdAt =
          ts && typeof ts.toDate === 'function' ? ts.toDate().toISOString() : new Date().toISOString();
        return {
          id: typeof data.id === 'string' ? data.id : d.id,
          ownerId: typeof data.ownerId === 'string' ? data.ownerId : uid,
          eventType: (data.eventType as AuditEventType) || 'login_success',
          summary: typeof data.summary === 'string' ? data.summary : '',
          severity:
            data.severity === 'critical' || data.severity === 'warning'
              ? data.severity
              : 'info',
          deviceLabel: typeof data.deviceLabel === 'string' ? data.deviceLabel : 'Web Browser',
          createdAt,
        } satisfies AuditLogRecord;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 50);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function syncEncryptedContactToCloud(
  uid: string,
  contact: ContactProfile
): Promise<void> {
  const contactId = safeId(contact.key || contact.name);
  const path = `users/${uid}/contacts/${contactId}`;
  const ref = doc(db, 'users', uid, 'contacts', contactId);
  try {
    const encryptedPayload = await encryptVaultJson(contact);
    if (encryptedPayload.length > 16000) {
      throw new Error('Encrypted contact payload exceeds document boundary.');
    }
    const snap = await getDoc(ref);
    if (snap.exists()) {
      await updateDoc(ref, {
        encryptedPayload,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(ref, {
        id: contactId,
        ownerId: safeId(uid),
        encryptedPayload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function loadEncryptedContactsFromCloud(
  uid: string
): Promise<Record<string, ContactProfile>> {
  const colPath = `users/${uid}/contacts`;
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    const result: Record<string, ContactProfile> = {};
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      const payload = typeof data.encryptedPayload === 'string' ? data.encryptedPayload : null;
      if (!payload) continue;
      const decrypted = await decryptVaultJson<ContactProfile | null>(payload, null);
      if (decrypted && decrypted.key && decrypted.name) {
        result[decrypted.key] = decrypted;
      }
    }
    return result;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, colPath);
  }
}

export async function clearCloudContacts(uid: string): Promise<void> {
  const colPath = `users/${uid}/contacts`;
  try {
    const q = query(collection(db, colPath), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      await deleteDoc(d.ref);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, colPath);
  }
}

export async function purgeAllUserFirestoreRecords(uid: string): Promise<void> {
  await clearCloudReminders(uid);
  await clearCloudContacts(uid);

  const sessionsCol = `users/${uid}/sessions`;
  const sessionsSnap = await getDocs(query(collection(db, sessionsCol), where('ownerId', '==', uid)));
  for (const d of sessionsSnap.docs) {
    await deleteDoc(d.ref);
  }

  try {
    await deleteDoc(doc(db, 'users', uid, 'privacySettings', 'config'));
  } catch {
    // Ignore if missing
  }

  // Note: users/{uid}/auditLogs are immutable/append-only in firestore.rules by security policy
  await deleteDoc(doc(db, 'users', uid));
}

