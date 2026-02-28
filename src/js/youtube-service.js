/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — (v10 Extreme Unified - Zero-Preflight)
 * 解決 404/502/CORS/HTML 污染的所有問題，確保一鍵全自動
 */

export const EngineConfig = {
    load() {
        try {
            const saved = localStorage.getItem('ktv_engine_config');
            return saved ? JSON.parse(saved) : { cookies: '', proxy: '', backend: '' };
        } catch { return { cookies: '', proxy: '', backend: '' }; }
    },
    save(config) {
        localStorage.setItem('ktv_engine_config', JSON.stringify(config));
    }
};

const SAME_ORIGIN_API = [''];
const EXTERNAL_BACKENDS = [
    'https://ktv-ey9t.onrender.com',
    'https://wicked-maps-return.loca.lt'
];

/** 智能請求器：不帶任何 Header 的 GET 請求 (防 CORS Preflight) */
async function simpleGet(url, signal) {
    try {
        console.log(`[v10] Simple GET: ${url}`);
        const res = await fetch(url, { method: 'GET', signal: signal || AbortSignal.timeout(6000) });
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return res;
    } catch (e) {
        console.warn(`[v10] Simple GET failed for ${url}: ${e.message}`);
        throw e;
    }
}

async function fetchWithFailover(path, options = {}) {
    const config = EngineConfig.load();
    const list = config.backend ? [config.backend, ...SAME_ORIGIN_API, ...EXTERNAL_BACKENDS] : [...SAME_ORIGIN_API, ...EXTERNAL_BACKENDS];
    const endpoints = [...new Set(list)];
    let lastError = null;

    for (const base of endpoints) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;

            // 重要：如果是 POST 且有 body，才加 Content-Type
            const headers = { ...options.headers };
            if (options.method === 'POST' && typeof options.body === 'string') {
                headers['Content-Type'] = 'application/json';
            }

            const res = await fetch(url, {
                ...options,
                headers,
                signal: options.signal || AbortSignal.timeout(10000)
            });
            if (res.ok) return res;
            if (res.status === 404) continue;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('後端暫時停機');
}

export async function searchYouTube(query) {
    const res = await fetchWithFailover('/search', { method: 'POST', body: JSON.stringify({ query }) });
    const data = await res.json();
    return data.results || [];
}

export async function fetchVideoInfo(url) {
    const res = await fetchWithFailover('/info', { method: 'POST', body: JSON.stringify({ url }) });
    const data = await res.json();
    return data.info;
}

/** 
 * 【v10 核心】全自動擷取 
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
    if (!videoId) throw new Error('網址格式錯誤');

    console.log(`[v10] Extracting ${videoId} on Web...`);

    // ── 第一波：Piped API (直連 browser -> mirror, 許多 mirror 開放了 CORS) ──
    const PIPED_MIRRORS = [
        'https://pipedapi.kavin.rocks',
        'https://api.piped.victr.me',
        'https://piped-api.garudalinux.org'
    ];

    for (const mirror of PIPED_MIRRORS) {
        try {
            console.log(`[v10] Trying Mirror Direct: ${mirror}`);
            const res = await fetch(`${mirror}/streams/${videoId}`, { signal: AbortSignal.timeout(5000) });
            if (res.ok) {
                const data = await res.json();
                if (data.audioStreams?.[0]?.url) {
                    const stream = data.audioStreams.find(s => s.format === 'M4A') || data.audioStreams[0];
                    console.log('[v10] Success! Direct mirror hit.');
                    return await _smartMediaFetch(stream.url, onProgress, signal);
                }
            }
        } catch (e) { console.warn(`[v10] Direct mirror ${mirror} fail: ${e.message}`); }
    }

    // ── 第二波：透過 AllOrigins / CodeTabs 抓取 Piped (無 Header GET，解決 CORS) ──
    const PROXY_TEMPLATES = [
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ];

    for (const pFn of PROXY_TEMPLATES) {
        try {
            const api = `${PIPED_MIRRORS[0]}/streams/${videoId}`;
            const pUrl = pFn(api);
            const res = await simpleGet(pUrl, signal);
            const raw = await res.json();
            const contents = raw.contents || (typeof raw === 'string' ? raw : JSON.stringify(raw));

            if (contents && contents.trim().startsWith('{')) {
                const data = JSON.parse(contents);
                if (data.audioStreams?.[0]?.url) {
                    onProgress?.(25);
                    return await _smartMediaFetch(data.audioStreams[0].url, onProgress, signal);
                }
            }
        } catch (e) { }
    }

    // ── 第三波：最終招：後端 Proxy (Vercel / Render / Local) ──
    try {
        console.log('[v10] Invoking Backup Backend Proxy...');
        onProgress?.(15);
        const res = await fetchWithFailover('/proxy', { method: 'POST', body: JSON.stringify({ url }), signal });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { }

    throw new Error('所有自動處理途徑皆已被限制。目前 YouTube 正處於強烈阻擋期，請改用「本地音檔分析」。');
}

/** 智能媒體下載 - 優先直連 */
async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    console.log('[v10] Fetching media bytes...');
    try {
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(10000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }

    const proxyRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`, { signal });
    if (proxyRes.ok) return await _readStreamToFile(proxyRes, 'audio.m4a', onProgress);

    throw new Error('串流讀取失敗');
}

async function _readStreamToFile(response, defaultName, onProgress) {
    const contentLength = +response.headers.get('Content-Length');
    const reader = response.body.getReader();
    let received = 0;
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (contentLength) {
            onProgress?.(10 + (received / contentLength) * 90);
        }
    }
    const blob = new Blob(chunks, { type: 'audio/mp4' });
    return new File([blob], defaultName, { type: 'audio/mp4' });
}

export async function checkAPIHealth() {
    try {
        const res = await fetchWithFailover('/health', { signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}

export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch { return false; }
}
