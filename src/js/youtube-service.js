/**
 * src/js/youtube-service.js
 * (v11 Extreme Unified - User-Presence & Tunnel Bypass)
 * 本版核心：1. 優先利用本地隧道繞過 IP 封鎖 2. 徹底消除 Preflight Headers 3. 跨域強效 failover
 */

export const EngineConfig = {
    load() {
        try {
            const saved = localStorage.getItem('ktv_engine_config');
            return saved ? JSON.parse(saved) : { cookies: '', proxy: '', backend: '' };
        } catch { return { cookies: '', proxy: '', backend: '' }; }
    },
    save(config) { localStorage.setItem('ktv_engine_config', JSON.stringify(config)); }
};

const EXTERNAL_BACKENDS = [
    'https://wicked-maps-return.loca.lt', // 您的本地機器 IP (最強大的擷取源)
    'https://ktv-ey9t.onrender.com'
];

/** 發送無 Preflight 的簡單請求 (防 CORS 攔截) */
async function silentGet(url, signal) {
    // 關鍵：不傳遞自定義 Header (如 Content-Type)，僅發送簡單 GET
    console.log(`[v11] Silent GET: ${url}`);
    const res = await fetch(url, { method: 'GET', signal: signal || AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res;
}

async function fetchWithFailover(path, options = {}) {
    // 按順序優先嘗試備援後端
    const endpoints = [...new Set([
        EngineConfig.load().backend,
        'https://wicked-maps-return.loca.lt',
        '', // 當前 origin (Vercel)
        'https://ktv-ey9t.onrender.com'
    ].filter(Boolean))];

    let lastError = null;
    for (const base of endpoints) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;
            console.log(`[v11] Back-End Fallover: ${url}`);

            // 避免帶入過多 Header
            const headers = { 'Accept': 'application/json' };
            if (options.method === 'POST') headers['Content-Type'] = 'application/json';

            const res = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(8000) });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('Backend Offline');
}

export async function searchYouTube(query) {
    const res = await fetchWithFailover('/search', { method: 'POST', body: JSON.stringify({ query }) });
    return (await res.json()).results || [];
}

export async function fetchVideoInfo(url) {
    const res = await fetchWithFailover('/info', { method: 'POST', body: JSON.stringify({ url }) });
    return (await res.json()).info;
}

/** 
 * 【v11 核心】一鍵全自動擷取 
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
    if (!videoId) throw new Error('網址解析失敗');

    // ── 策略 1: 專用後端代理 (優先使用 wicked-maps-return.loca.lt) ──
    try {
        console.log('[v11] Strategy: Secure Backend Proxy...');
        const res = await fetchWithFailover('/proxy', {
            method: 'POST',
            body: JSON.stringify({ url }),
            signal
        });
        if (res.ok) {
            const data = await res.json();
            if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
        }
    } catch (e) { console.warn('[v11] Backend Proxy failed:', e.message); }

    // ── 策略 2: Piped API (不帶 Header 獲取，解決 CORS) ──
    const MIRRORS = ['https://pipedapi.kavin.rocks', 'https://api.piped.victr.me'];
    for (const mirror of MIRRORS) {
        try {
            const api = `${mirror}/streams/${videoId}`;
            // 使用 AllOrigins GET 模式
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(api)}`;
            const res = await silentGet(proxyUrl, signal);
            const raw = await res.json();
            const contents = JSON.parse(raw.contents);
            if (contents.audioStreams?.[0]?.url) {
                return await _smartMediaFetch(contents.audioStreams[0].url, onProgress, signal);
            }
        } catch (e) { console.warn(`[v11] Mirror ${mirror} failed:`, e.message); }
    }

    throw new Error('自動擷取暫時受限，請點擊「本地分軌」手動上傳。');
}

async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    // 第一步：直連 (音軌通常不會有嚴重的 CORS，除非 IP 被封)
    try {
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(10000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }

    // 第二步：Raw 轉接 (解決封 IP 或跨域)
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
    const res2 = await fetch(proxyUrl, { signal });
    if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);

    throw new Error('Streaming failed');
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
        if (contentLength) onProgress?.(10 + (received / contentLength) * 90);
    }
    return new File([new Blob(chunks)], defaultName, { type: 'audio/mp4' });
}

export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch { return false; }
}

export async function checkAPIHealth() {
    try {
        const res = await fetchWithFailover('/health', { signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}
