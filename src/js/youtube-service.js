/**
 * src/js/youtube-service.js
 * (v15 Extreme Unified - Direct Browser-Mirror & User Presence)
 * 解決所有伺服器端 502/404/511 錯誤，透過瀏覽器直接對接鏡像源。
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
    'https://wicked-maps-return.loca.lt',
    'https://ktv-ey9t.onrender.com'
];

/** 核心請求引擎 (v15) - 自動注入隧道繞過 Header */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = [...new Set([config.backend, '', ...EXTERNAL_BACKENDS])].filter(b => b !== null && b !== undefined);

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;
            console.log(`[v15] Requesting: ${url}`);

            const isLocalTunnel = base.includes('loca.lt');
            const headers = {
                'Accept': 'application/json',
                'Bypass-Tunnel-Reminder': 'true' // 核心：繞過 LocalTunnel 提醒頁面
            };
            if (options.method === 'POST') headers['Content-Type'] = 'application/json';

            const res = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(10000) });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('後端服務忙碌中');
}

/** 搜尋：穩定 GET 模式 */
export async function searchYouTube(query) {
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`, { method: 'GET' });
    const data = await res.json();
    return data.results || [];
}

export async function fetchVideoInfo(url) {
    const res = await apiRequest(`/info?url=${encodeURIComponent(url)}`, { method: 'GET' });
    const data = await res.json();
    return data.info;
}

/** 【v15 核心】最高品質自動下載 (直接利用瀏覽器連向鏡像) */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // ── 策略 1: 專屬 Vercel/Local 代理 ──
    try {
        console.log('[v15] Strategy 1: Multi-Proxy Backend...');
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`, { method: 'GET', signal });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { console.warn('[v15] Strategy 1 fail:', e.message); }

    // ── 策略 2: 瀏覽器直連 Invidious/Piped (解決後端被打死) ──
    const DIRECT_MIRRORS = [
        `https://inv.vern.cc/api/v1/videos/${videoId}`,
        `https://invidious.snopyta.org/api/v1/videos/${videoId}`,
        `https://pipedapi.pablo.casa/streams/${videoId}`
    ];

    for (const mirror of DIRECT_MIRRORS) {
        try {
            console.log(`[v15] Strategy 2: Direct Browser-Mirror: ${mirror}`);
            // 注意：直連如果沒 CORS，我們套 AllOrigins
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(mirror)}`;
            const res = await fetch(proxyUrl, { signal });
            if (!res.ok) continue;

            const raw = await res.json();
            const data = JSON.parse(raw.contents); // AllOrigins 包裝

            // 嘗試從 Invidious 或 Piped 格式中提取
            const stream = data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url || data.audioStreams?.[0]?.url;
            if (stream) {
                console.log('[v15] Success! Mirror hit from browser.');
                return await _smartMediaFetch(stream, onProgress, signal);
            }
        } catch (e) { console.warn(`[v15] Mirror ${mirror} fail:`, e.message); }
    }

    throw new Error('自動擷取目前因 YouTube 改版暫時離線。請選擇「本地音檔分析」手動分析。');
}

/** 媒體下載 - 優先利用瀏覽器直連 */
async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    console.log('[v15] Starting stream fetch...');
    try {
        // 先直連 (媒體串流通常 CORS 緩慢，但如果沒封鎖 IP 就最快)
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(12000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }

    // 第二段：AllOrigins RAW 代理下載 (解決媒體跨域)
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
    console.log(`[v15] Fetching blob via RAW Proxy: ${proxyUrl}`);
    const res2 = await fetch(proxyUrl, { signal });
    if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);

    throw new Error('串流獲取失敗');
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
        const res = await apiRequest('/health', { method: 'GET', signal: AbortSignal.timeout(4000) });
        return { ok: res.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}
