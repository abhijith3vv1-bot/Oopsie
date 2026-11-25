/* eslint-disable no-restricted-globals */
export {};

interface PrecacheEntry {
  url: string;
  revision?: string | null;
}

declare global {
  interface Window {
    __WB_MANIFEST?: Array<PrecacheEntry | string>;
  }
}

interface SWExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface SWFetchEvent extends SWExtendableEvent {
  request: Request;
  respondWith(response: Promise<Response> | Response): void;
}

interface SWMessageEvent extends SWExtendableEvent {
  data?: { type?: string };
}

interface SWNotificationData {
  itemId?: string;
}

interface SWNotification {
  data?: SWNotificationData;
  close(): void;
}

interface SWNotificationEvent extends SWExtendableEvent {
  action: string;
  notification: SWNotification;
}

interface SWWindowClient {
  url: string;
  focus(): Promise<SWWindowClient>;
  postMessage(message: unknown): void;
}

interface SWClients {
  claim(): Promise<void>;
  matchAll(options?: { type?: string; includeUncontrolled?: boolean }): Promise<SWWindowClient[]>;
  openWindow(url: string): Promise<SWWindowClient | null>;
}

interface SWGlobalScope {
  location: Location;
  clients: SWClients;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install', listener: (event: SWExtendableEvent) => void): void;
  addEventListener(type: 'activate', listener: (event: SWExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: SWFetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: SWMessageEvent) => void): void;
  addEventListener(type: 'notificationclick', listener: (event: SWNotificationEvent) => void): void;
}

const sw = self as unknown as SWGlobalScope;
const CACHE_NAME = 'oopsie-shell-v2';

// vite-plugin-pwa injects static app-shell precache entries here during build
const injectedManifest: Array<PrecacheEntry | string> = self.__WB_MANIFEST || [];
const PRECACHE_URLS = Array.from(
  new Set([
    '/',
    '/index.html',
    '/manifest.webmanifest',
    '/icon.svg',
    '/pwa-192x192.png',
    '/pwa-512x512.png',
    '/pwa-maskable-512x512.png',
    '/apple-touch-icon.png',
    ...injectedManifest
      .map((entry) => (typeof entry === 'string' ? entry : entry.url))
      .filter((url) => !url.startsWith('/api/') && !url.startsWith('/__/')),
  ])
);

const STATIC_DESTINATIONS = new Set(['script', 'style', 'image', 'font', 'manifest']);
const STATIC_ASSET_EXT = /\.(?:js|mjs|css|svg|png|jpe?g|webp|ico|woff2?|webmanifest)$/i;

function isSensitiveOrDynamicPath(url: URL): boolean {
  if (url.pathname.startsWith('/api/')) return true;
  if (url.pathname.startsWith('/__/')) return true;
  // Never cache parameterized URLs (e.g. Web Share Target ?text=..., ?alarmAction=..., OAuth codes/tokens)
  if (url.search && url.search.length > 0) return true;
  return false;
}

function isStaticAssetRequest(request: Request, url: URL): boolean {
  if (isSensitiveOrDynamicPath(url)) return false;
  if (STATIC_DESTINATIONS.has(request.destination)) return true;
  if (url.pathname.startsWith('/assets/')) return true;
  return STATIC_ASSET_EXT.test(url.pathname);
}

sw.addEventListener('install', (event) => {
  // Wait for user confirmation via SKIP_WAITING before activating a new version
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
  );
});

sw.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(sw.skipWaiting());
  }
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => sw.clients.claim())
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // Strictly ignore cross-origin traffic (Firestore, Firebase Auth, Gmail/Calendar APIs, Gemini, etc.)
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/__/')) return;

  // Navigation requests: network-first, cache only clean root shell, fallback to cached shell offline
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok && url.pathname === '/' && !url.search) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(async () => {
          return (
            (await caches.match('/')) ||
            (await caches.match('/index.html')) ||
            Response.error()
          );
        })
    );
    return;
  }

  // Only cache same-origin static assets (JS, CSS, fonts, images, manifest). Everything else is network-only.
  if (!isStaticAssetRequest(request, url)) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok && response.type === 'basic') {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());

      return cached || networkFetch;
    })
  );
});

sw.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const action = event.action || 'open';
  const itemId = event.notification.data?.itemId || '';

  event.waitUntil(
    sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          await client.focus();
        }
        client.postMessage({
          type: 'OOPSIE_NOTIFICATION_ACTION',
          action,
          itemId,
        });
        return;
      }

      const targetUrl = itemId
        ? `/?alarmAction=${encodeURIComponent(action)}&itemId=${encodeURIComponent(itemId)}`
        : '/';
      await sw.clients.openWindow(targetUrl);
    })
  );
});
