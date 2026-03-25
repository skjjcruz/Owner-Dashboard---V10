// ============================================================
// OWNER DASHBOARD — SERVICE WORKER
// Handles PWA cache management and automatic updates.
// Bump the version comment on every deployment so the browser
// detects a file change and kicks off the update cycle.
// Version: 2026.03.25.1
// ============================================================

const CACHE_NAME = 'owner-dashboard-2026.03.25.1';

// Local assets to precache on install
const PRECACHE = [
    './',
    './index.html',
    './supabase-client.js',
    './themes.js',
    './draft-history.js',
    './charts.js',
    './manifest.json',
    './icon-192.png',
    './icon-512.png'
];

// Domains that should always go straight to the network (never cached)
const NETWORK_ONLY_HOSTS = [
    'api.sleeper.app',
    'supabase.co',
    'googleapis.com',
    'unpkg.com',
    'jsdelivr.net',
    'jcc100218.github.io',
    'sleepercdn.com'
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', e => {
    // Skip waiting so the new SW activates immediately — don't
    // hold off until all tabs running the old version are closed.
    self.skipWaiting();
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(PRECACHE))
            .catch(() => {}) // Non-fatal — network may be offline
    );
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        Promise.all([
            // Wipe every cache that isn't the current version
            caches.keys().then(keys =>
                Promise.all(
                    keys
                        .filter(k => k !== CACHE_NAME)
                        .map(k => caches.delete(k))
                )
            ),
            // Take control of every open tab/window immediately
            self.clients.claim()
        ])
    );
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
    const { request } = e;
    const url = new URL(request.url);

    // 1. Let API / CDN calls go straight to the network
    if (NETWORK_ONLY_HOSTS.some(h => url.hostname.includes(h))) return;

    // 2. Network-first for HTML navigation — always load fresh markup
    if (request.mode === 'navigate' || request.destination === 'document') {
        e.respondWith(
            fetch(request)
                .then(res => {
                    if (res.ok) {
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, res.clone()));
                    }
                    return res;
                })
                .catch(() => caches.match(request))
        );
        return;
    }

    // 3. Cache-first for all other local assets (JS, CSS, images)
    if (url.origin === self.location.origin) {
        e.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(res => {
                    if (res.ok) {
                        caches.open(CACHE_NAME)
                            .then(cache => cache.put(request, res.clone()));
                    }
                    return res;
                });
            })
        );
    }
});
