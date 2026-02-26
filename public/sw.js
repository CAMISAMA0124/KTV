/**
 * public/sw.js — Service Worker (PWA)
 * 快取靜態資源以支援離線使用與 iPhone 主畫面安裝
 */

const CACHE_NAME = 'stemsplit-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/src/style.css',
    '/src/js/main.js',
    '/src/js/env-check.js',
    '/src/js/opfs-cache.js',
    '/src/js/model-loader.js',
    '/src/js/audio-processor.js',
    '/src/js/inference-engine.js',
    '/src/js/audio-merger.js',
    '/src/js/ui-controller.js',
    '/src/js/url-importer.js',
    '/manifest.json',
];

// ── Install ──────────────────────────────────────────────────
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // 靜默快取，失敗不阻止安裝
            return cache.addAll(STATIC_ASSETS).catch(() => { });
        })
    );
    self.skipWaiting();
});

// ── Activate ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// ── Fetch ────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // API 呼叫不快取（直接 network）
    if (url.pathname.startsWith('/api/')) {
        return event.respondWith(fetch(event.request));
    }

    // HuggingFace 模型檔案不走 SW（由 OPFS 自行管理）
    if (url.hostname.includes('huggingface.co') || url.hostname.includes('cdn.jsdelivr.net')) {
        return event.respondWith(fetch(event.request));
    }

    // Stale-While-Revalidate：先回 cache，背景更新
    event.respondWith(
        caches.open(CACHE_NAME).then(async (cache) => {
            const cached = await cache.match(event.request);
            const fetchPromise = fetch(event.request)
                .then((res) => {
                    if (res.ok) cache.put(event.request, res.clone());
                    return res;
                })
                .catch(() => cached); // offline fallback
            return cached || fetchPromise;
        })
    );
});
