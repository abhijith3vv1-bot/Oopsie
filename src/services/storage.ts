import type { ReminderItem, UserProfile } from '../types/reminder';
import { decryptVaultJson, encryptVaultJson } from './cryptoVault';

const PROFILE_KEY = 'the_reminder_profile_v1';
const LEGACY_ITEMS_KEY = 'the_reminder_items_v1';
export const ITEMS_VAULT_KEY = 'the_reminder_items_vault_v2';
const LAST_SEEN_KEY = 'the_reminder_last_seen_v1';

export function getDefaultProfile(): UserProfile {
  const detectedTz =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : 'UTC';

  return {
    name: '',
    reminderStyle: 'gentle',
    wakeTime: '07:30',
    sleepTime: '22:30',
    timezone: detectedTz,
    theme: 'light',
    soundEnabled: true,
    alarmTone: 'bubble_pop',
    alarmVolume: 0.8,
    alarmIntensity: 'gentle',
    audioUnlocked: false,
    onboardingComplete: false,
    streakDays: 0,
    lastClosedDate: null,
    closedCountTotal: 0,
    lastBriefingDate: null,
  };
}

export function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return getDefaultProfile();
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    return { ...getDefaultProfile(), ...parsed };
  } catch {
    return getDefaultProfile();
  }
}

export function saveProfile(profile: UserProfile): void {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

export function loadItems(): ReminderItem[] {
  try {
    const legacy = localStorage.getItem(LEGACY_ITEMS_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      return Array.isArray(parsed) ? parsed : [];
    }
    return [];
  } catch {
    return [];
  }
}

export async function hydrateEncryptedLocalItems(): Promise<ReminderItem[]> {
  try {
    const cipher = localStorage.getItem(ITEMS_VAULT_KEY);
    if (cipher) {
      const decrypted = await decryptVaultJson<ReminderItem[]>(cipher, []);
      if (Array.isArray(decrypted)) {
        try {
          localStorage.removeItem(LEGACY_ITEMS_KEY);
        } catch {
          // Ignore
        }
        return decrypted;
      }
    }

    const legacy = loadItems();
    if (legacy.length > 0) {
      await saveItemsEncrypted(legacy);
    }
    return legacy;
  } catch {
    return loadItems();
  }
}

export async function saveItemsEncrypted(items: ReminderItem[]): Promise<void> {
  try {
    const cipher = await encryptVaultJson(items);
    localStorage.setItem(ITEMS_VAULT_KEY, cipher);
    // Wipe legacy plaintext reminders key once encrypted vault succeeds
    localStorage.removeItem(LEGACY_ITEMS_KEY);
  } catch {
    // Fallback only if SubtleCrypto is unavailable in browser environment
    localStorage.setItem(LEGACY_ITEMS_KEY, JSON.stringify(items));
  }
}

export function saveItems(items: ReminderItem[]): void {
  void saveItemsEncrypted(items);
}

export function getLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function recordLoopClosed(profile: UserProfile): UserProfile {
  const today = getLocalDateKey();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = getLocalDateKey(yesterdayDate);

  let nextStreak = profile.streakDays;
  if (profile.lastClosedDate === today) {
    nextStreak = Math.max(1, profile.streakDays);
  } else if (profile.lastClosedDate === yesterday) {
    nextStreak = profile.streakDays + 1;
  } else {
    nextStreak = 1;
  }

  return {
    ...profile,
    streakDays: nextStreak,
    lastClosedDate: today,
    closedCountTotal: profile.closedCountTotal + 1,
  };
}

export interface ExportBundle {
  version: 1;
  exportedAt: string;
  profile: UserProfile;
  items: ReminderItem[];
}

export function exportAllData(profile: UserProfile, items: ReminderItem[]): string {
  const bundle: ExportBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    items,
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseImportedData(jsonString: string): {
  profile: UserProfile;
  items: ReminderItem[];
} {
  const parsed = JSON.parse(jsonString) as Partial<ExportBundle>;
  if (!parsed || !Array.isArray(parsed.items)) {
    throw new Error('Invalid backup file: expected an "items" list.');
  }

  const sanitizedItems: ReminderItem[] = parsed.items.map((item) => ({
    id: String(item.id || crypto.randomUUID()),
    title: String(item.title || 'Untitled reminder').slice(0, 280),
    person: item.person ?? null,
    project: item.project ?? null,
    category: item.category || 'Personal',
    priority: item.priority || 'medium',
    dueAt: item.dueAt || new Date().toISOString(),
    status: item.status || 'needs_action',
    followUpRule: item.followUpRule || { enabled: false, intervalDays: null, description: null },
    snoozeCount: Number(item.snoozeCount || 0),
    lastNotifiedAt: item.lastNotifiedAt ?? null,
    lastActivityAt: item.lastActivityAt || item.createdAt || new Date().toISOString(),
    createdAt: item.createdAt || new Date().toISOString(),
    closedAt: item.closedAt ?? null,
    timeline: Array.isArray(item.timeline) ? item.timeline : [],
  }));

  const mergedProfile: UserProfile = {
    ...getDefaultProfile(),
    ...(parsed.profile || {}),
    onboardingComplete: true,
  };

  return {
    profile: mergedProfile,
    items: sanitizedItems,
  };
}

export function loadLastSeenAt(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

export function saveLastSeenAt(iso = new Date().toISOString()): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, iso);
  } catch {
    // Ignore storage quota issues
  }
}

export function clearAllData(): void {
  localStorage.removeItem(PROFILE_KEY);
  localStorage.removeItem(LEGACY_ITEMS_KEY);
  localStorage.removeItem(ITEMS_VAULT_KEY);
  localStorage.removeItem(LAST_SEEN_KEY);
}
