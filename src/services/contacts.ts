import type { ContactProfile, PersonSummary, ReminderItem } from '../types/reminder';
import { decryptVaultJson, encryptVaultJson } from './cryptoVault';
import { getSampleContacts } from './sampleData';

const LEGACY_CONTACTS_STORAGE_KEY = 'oopsie_contacts_v1';
export const CONTACTS_VAULT_KEY = 'oopsie_contacts_vault_v2';

export function normalizePersonKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function formatPersonDisplayName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function loadContactsMap(): Record<string, ContactProfile> {
  try {
    const raw = localStorage.getItem(LEGACY_CONTACTS_STORAGE_KEY);
    if (!raw) {
      // Wait for async encrypted vault hydration before falling back to sample contacts
      if (localStorage.getItem(CONTACTS_VAULT_KEY)) {
        return {};
      }
      const defaults: Record<string, ContactProfile> = {};
      for (const c of getSampleContacts()) {
        defaults[normalizePersonKey(c.name)] = c;
      }
      return defaults;
    }
    const parsed = JSON.parse(raw) as Record<string, ContactProfile>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function hydrateEncryptedContactsMap(): Promise<Record<string, ContactProfile>> {
  try {
    const cipher = localStorage.getItem(CONTACTS_VAULT_KEY);
    if (cipher) {
      const decrypted = await decryptVaultJson<Record<string, ContactProfile>>(cipher, {});
      if (decrypted && typeof decrypted === 'object') {
        try {
          localStorage.removeItem(LEGACY_CONTACTS_STORAGE_KEY);
        } catch {
          // Ignore
        }
        return decrypted;
      }
    }

    const legacy = loadContactsMap();
    if (Object.keys(legacy).length > 0) {
      await saveContactsMapEncrypted(legacy);
    }
    return legacy;
  } catch {
    return loadContactsMap();
  }
}

export async function saveContactsMapEncrypted(
  map: Record<string, ContactProfile>
): Promise<void> {
  try {
    const cipher = await encryptVaultJson(map);
    localStorage.setItem(CONTACTS_VAULT_KEY, cipher);
    localStorage.removeItem(LEGACY_CONTACTS_STORAGE_KEY);
  } catch {
    try {
      localStorage.setItem(LEGACY_CONTACTS_STORAGE_KEY, JSON.stringify(map));
    } catch {
      // Ignore quota errors
    }
  }
}

export function saveContactsMap(map: Record<string, ContactProfile>): void {
  void saveContactsMapEncrypted(map);
}

export function clearLocalContactsVault(): void {
  try {
    localStorage.removeItem(CONTACTS_VAULT_KEY);
    localStorage.removeItem(LEGACY_CONTACTS_STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function upsertContactProfile(
  currentMap: Record<string, ContactProfile>,
  profile: ContactProfile
): Record<string, ContactProfile> {
  const key = normalizePersonKey(profile.name || profile.key);
  if (!key) return currentMap;
  const next = {
    ...currentMap,
    [key]: {
      ...currentMap[key],
      ...profile,
      key,
      name: formatPersonDisplayName(profile.name || profile.key),
    },
  };
  saveContactsMap(next);
  return next;
}

export function buildPeopleSummaries(
  items: ReminderItem[],
  contactsMap: Record<string, ContactProfile>
): PersonSummary[] {
  const groups = new Map<
    string,
    {
      key: string;
      name: string;
      items: ReminderItem[];
    }
  >();

  // Include saved contacts even if they have 0 reminders yet
  for (const contact of Object.values(contactsMap)) {
    const key = normalizePersonKey(contact.name || contact.key);
    if (!key) continue;
    groups.set(key, {
      key,
      name: formatPersonDisplayName(contact.name),
      items: [],
    });
  }

  for (const item of items) {
    const raw = item.person?.trim();
    if (!raw) continue;
    const key = normalizePersonKey(raw);
    const existing = groups.get(key) || {
      key,
      name: formatPersonDisplayName(raw),
      items: [],
    };
    existing.items.push(item);
    groups.set(key, existing);
  }

  const summaries: PersonSummary[] = [];
  for (const group of groups.values()) {
    const storedContact = contactsMap[group.key] || {
      key: group.key,
      name: group.name,
    };

    const sortedAll = [...group.items].sort(
      (a, b) => new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );
    const pendingItems = sortedAll
      .filter((i) => i.status !== 'closed')
      .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime());
    const completedItems = sortedAll.filter((i) => i.status === 'closed');

    const promises: PersonSummary['promisesAndCommitments'] = [];

    // Custom saved commitments on the contact profile
    for (const cText of storedContact.commitments || []) {
      promises.push({
        id: `custom-${group.key}-${cText}`,
        text: cText,
        itemId: '',
        itemTitle: 'Pinned commitment',
        status: 'waiting',
        timestamp: sortedAll[0]?.lastActivityAt || new Date().toISOString(),
      });
    }

    // Derived promises & commitments from followUpRule conditions and updates
    for (const item of sortedAll) {
      if (item.followUpRule.enabled && item.followUpRule.description) {
        promises.push({
          id: `rule-${item.id}`,
          text: item.followUpRule.description,
          itemId: item.id,
          itemTitle: item.title,
          status: item.status,
          timestamp: item.lastActivityAt,
        });
      }
      const updates = item.timeline.filter(
        (t) =>
          t.type === 'user_update' ||
          t.type === 'ai_summary' ||
          (t.type === 'created' && /promise|commit|send|confirm|agree|by\s+\w+/i.test(t.text))
      );
      for (const up of updates.slice(-2)) {
        promises.push({
          id: up.id,
          text: up.text,
          itemId: item.id,
          itemTitle: item.title,
          status: item.status,
          timestamp: up.timestamp,
        });
      }
    }

    const lastInteractionAt = sortedAll.length > 0 ? sortedAll[0].lastActivityAt : null;

    summaries.push({
      key: group.key,
      name: storedContact.name || group.name,
      contact: {
        ...storedContact,
        key: group.key,
        name: storedContact.name || group.name,
      },
      pendingItems,
      completedItems,
      allItems: sortedAll,
      promisesAndCommitments: promises.slice(0, 12),
      lastInteractionAt,
    });
  }

  return summaries.sort((a, b) => {
    if (b.pendingItems.length !== a.pendingItems.length) {
      return b.pendingItems.length - a.pendingItems.length;
    }
    const aTime = a.lastInteractionAt ? new Date(a.lastInteractionAt).getTime() : 0;
    const bTime = b.lastInteractionAt ? new Date(b.lastInteractionAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return a.name.localeCompare(b.name);
  });
}
