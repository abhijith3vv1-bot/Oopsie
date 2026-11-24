const DB_NAME = 'oopsie_connect_vault_v1';
const STORE_NAME = 'keys';
const KEY_ID = 'aes_gcm_master';
const FALLBACK_KEY_STORAGE = 'oopsie_connect_vault_fallback_v1';
const KEY_VERSION_STORAGE = 'oopsie_vault_key_version_v1';

let memoryKeyPromise: Promise<CryptoKey | null> | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function openVaultDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open key vault'));
  });
}

async function readKeyFromIdb(): Promise<CryptoKey | null> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(KEY_ID);
    req.onsuccess = () => {
      db.close();
      resolve((req.result as CryptoKey | undefined) ?? null);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function writeKeyToIdb(key: CryptoKey): Promise<void> {
  const db = await openVaultDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(key, KEY_ID);
    req.onsuccess = () => {
      db.close();
      resolve();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

export function getLocalVaultKeyVersion(): number {
  try {
    const raw = localStorage.getItem(KEY_VERSION_STORAGE);
    const parsed = raw ? Number(raw) : 1;
    return Number.isFinite(parsed) && parsed >= 1 ? Math.round(parsed) : 1;
  } catch {
    return 1;
  }
}

function setLocalVaultKeyVersion(version: number): void {
  try {
    localStorage.setItem(KEY_VERSION_STORAGE, String(Math.max(1, Math.round(version))));
  } catch {
    // Ignore storage quota errors
  }
}

async function createAndStoreFreshVaultKey(): Promise<CryptoKey> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error('Browser cryptographic storage is unavailable in this environment.');
  }
  try {
    const generated = await window.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable key inside IndexedDB
      ['encrypt', 'decrypt']
    );
    await writeKeyToIdb(generated);
    try {
      localStorage.removeItem(FALLBACK_KEY_STORAGE);
    } catch {
      // Ignore
    }
    return generated;
  } catch {
    const rawKey = window.crypto.getRandomValues(new Uint8Array(32));
    localStorage.setItem(FALLBACK_KEY_STORAGE, bytesToBase64(rawKey));
    return await window.crypto.subtle.importKey(
      'raw',
      rawKey.buffer as ArrayBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
}

async function getOrCreateVaultKey(): Promise<CryptoKey | null> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    return null;
  }
  if (!memoryKeyPromise) {
    memoryKeyPromise = (async () => {
      try {
        const existing = await readKeyFromIdb();
        if (existing) return existing;
        return await createAndStoreFreshVaultKey();
      } catch {
        try {
          const existingRaw = localStorage.getItem(FALLBACK_KEY_STORAGE);
          if (existingRaw) {
            const rawBytes = base64ToBytes(existingRaw);
            return await window.crypto.subtle.importKey(
              'raw',
              rawBytes.buffer as ArrayBuffer,
              { name: 'AES-GCM', length: 256 },
              false,
              ['encrypt', 'decrypt']
            );
          }
          return await createAndStoreFreshVaultKey();
        } catch {
          return null;
        }
      }
    })();
  }
  return memoryKeyPromise;
}

async function encryptWithSpecificKey<T>(key: CryptoKey, data: T): Promise<string> {
  const serialized = JSON.stringify(data);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(serialized);
  const cipherBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return JSON.stringify({
    v: 1,
    kv: getLocalVaultKeyVersion(),
    alg: 'AES-GCM-256',
    iv: bytesToBase64(iv),
    ct: bytesToBase64(new Uint8Array(cipherBuffer)),
  });
}

async function decryptWithSpecificKey<T>(
  key: CryptoKey,
  payload: string | null,
  fallback: T
): Promise<T> {
  if (!payload) return fallback;
  try {
    const parsed = JSON.parse(payload) as {
      v?: number;
      alg?: string;
      iv?: string;
      ct?: string;
    };
    if (!parsed || parsed.v !== 1 || !parsed.iv || !parsed.ct) {
      return fallback;
    }
    const iv = base64ToBytes(parsed.iv);
    const ct = base64ToBytes(parsed.ct);
    const plainBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ct.buffer as ArrayBuffer
    );
    const decoded = new TextDecoder().decode(plainBuffer);
    return JSON.parse(decoded) as T;
  } catch {
    return fallback;
  }
}

export async function encryptVaultJson<T>(data: T): Promise<string> {
  const key = await getOrCreateVaultKey();
  if (!key) {
    throw new Error('Browser cryptographic storage is unavailable in this environment.');
  }
  return encryptWithSpecificKey(key, data);
}

export async function decryptVaultJson<T>(payload: string | null, fallback: T): Promise<T> {
  if (!payload) return fallback;
  const key = await getOrCreateVaultKey();
  if (!key) return fallback;
  return decryptWithSpecificKey(key, payload, fallback);
}

/**
 * Rotates the AES-GCM-256 master key atomically:
 * 1. Decrypts every provided encrypted localStorage key under the old key.
 * 2. Generates and stores a brand-new non-extractable AES-GCM-256 key.
 * 3. Re-encrypts every payload under the new key and bumps local key version.
 */
export async function rotateVaultKeyForStorageKeys(storageKeys: string[]): Promise<number> {
  const oldKey = await getOrCreateVaultKey();
  if (!oldKey) {
    throw new Error('Browser cryptographic storage is unavailable.');
  }

  const decryptedEntries = new Map<string, unknown>();
  for (const keyName of storageKeys) {
    try {
      const raw = localStorage.getItem(keyName);
      if (!raw) continue;
      const sentinel = Symbol('decrypt-miss');
      const val = await decryptWithSpecificKey<unknown>(oldKey, raw, sentinel);
      if (val !== sentinel) {
        decryptedEntries.set(keyName, val);
      }
    } catch {
      // Skip unreadable entry cleanly
    }
  }

  const nextVersion = getLocalVaultKeyVersion() + 1;
  setLocalVaultKeyVersion(nextVersion);

  const newKey = await createAndStoreFreshVaultKey();
  memoryKeyPromise = Promise.resolve(newKey);

  for (const [keyName, plainValue] of decryptedEntries.entries()) {
    const reencrypted = await encryptWithSpecificKey(newKey, plainValue);
    localStorage.setItem(keyName, reencrypted);
  }

  return nextVersion;
}

export async function wipeConnectVaultKey(): Promise<void> {
  memoryKeyPromise = null;
  try {
    localStorage.removeItem(FALLBACK_KEY_STORAGE);
    localStorage.removeItem(KEY_VERSION_STORAGE);
  } catch {
    // Ignore
  }
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(KEY_ID);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    });
  } catch {
    // Ignore
  }
}
