/**
 * Scoped app shell: precache same-origin static assets only.
 * /api/* is always fetched from the network (no CacheStorage writes).
 *
 * Bump STATIC_ASSET_VERSION whenever you ship new HTML/CSS/JS so the old
 * precache bucket is deleted on activate (avoids stale large bundles).
 * Changing this file also triggers a service-worker update check in browsers.
 */
const STATIC_ASSET_VERSION = "20260423-2";
const STATIC_CACHE = `acwr-static-${STATIC_ASSET_VERSION}`;

const PRECACHE_URLS = [
  "/",
  "/ai_cricket_war_room.html",
  "/ai_cricket_war_room.css",
  "/ai_cricket_war_room.js",
  "/manifest.webmanifest",
  "/match_suggestions.json",
  "/icons/favicon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: "reload" }))))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k.startsWith("acwr-static-") && k !== STATIC_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

/**
 * @param {Request} request
 */
function isNavigationRequest(request) {
  return request.mode === "navigate" || (request.headers.get("Accept") || "").includes("text/html");
}

/**
 * @param {Request} request
 */
async function networkFirstNavigate(request) {
  try {
    const res = await fetch(request);
    if (res.ok && res.type !== "opaqueredirect") {
      try {
        const cache = await caches.open(STATIC_CACHE);
        await cache.put(new Request("/", { credentials: "same-origin" }), res.clone());
      } catch {
        /* ignore cache write failures */
      }
    }
    return res;
  } catch {
    const cached =
      (await caches.match(request, { ignoreSearch: true })) ||
      (await caches.match("/", { ignoreSearch: true })) ||
      (await caches.match("/ai_cricket_war_room.html"));
    if (cached) return cached;
    return new Response("Offline", { status: 503, statusText: "Service Unavailable" });
  }
}

/**
 * @param {Request} request
 */
async function cacheFirstStatic(request) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res.ok) {
      const cache = await caches.open(STATIC_CACHE);
      await cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    return new Response("", { status: 504, statusText: "Gateway Timeout" });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  if (url.pathname === "/sw.js") {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") return;

  if (request.method === "HEAD") {
    event.respondWith(fetch(request));
    return;
  }

  if (isNavigationRequest(request)) {
    event.respondWith(networkFirstNavigate(request));
    return;
  }

  event.respondWith(cacheFirstStatic(request));
});
