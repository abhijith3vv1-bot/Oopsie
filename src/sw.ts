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
  addEventListener(type: 'notificationclick', listener: (event: SWNotificationEvent) => void): void;
}

const sw = self as unknown as SWGlobalScope;
const CACHE_NAME = 'oopsie-cache-v1';

// vite-plugin-pwa injects precache entries here during build
const injectedManifest: Array<PrecacheEntry | string> = self.__WB_MANIFEST || [];
const PRECACHE_URLS = Array.from(
  new Set([
    '/',
    '/icon.svg',
    '/pwa-192x192.png',
    '/pwa-512x512.png',
    '/apple-touch-icon.png',
    ...injectedManifest.map((entry) => (typeof entry === 'string' ? entry : entry.url)),
  ])
);

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)))
      )
      .then(() => sw.skipWaiting())
  );
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
  if (url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          return cached || (await caches.match('/')) || Response.error();
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const networkFetch = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
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
