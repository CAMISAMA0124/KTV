/**
 * src/js/youtube-service.js
 * (v12 Extreme Unified - Zero-Friction Tunnel Bypass)
 * 本版焦點：1. 自動繞過 LocalTunnel 驗證 2. 搜尋改為 GET 避開 CORS 3. 全面自動化擷取
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

/** 核心請求引擎：自動注入隧道繞過 Header */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = [...new Set([config.backend, ...EXTERNAL_BACKENDS, ''])].filter(base => base !== null && base !== undefined);

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;
            console.log(`[v12] Requesting: ${url}`);

            const headers = {
                'Accept': 'application/json',
                'Bypass-Tunnel-Reminder': 'true' // 關鍵：繞過 LocalTunnel 提醒頁面
            };
            if (options.method === 'POST') headers['Content-Type'] = 'application/json';

            const res = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(10000) });
            if (res.ok) return res;
            if (res.status === 404) continue;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('所有後端伺服器皆忙碌中');
}

/** 搜尋改為 GET 以減少 CORS Preflight 攔截 */
export async function searchYouTube(query) {
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`, { method: 'GET' });
    const data = await res.json();
    return data.results || [];
}

export async function fetchVideoInfo(url) {
    const res = await apiRequest('/info', { method: 'POST', body: JSON.stringify({ url }) });
    const data = await res.json();
    return data.info;
}

/** 【v12 核心】最高優先級自動下載 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // ── 策略 1: 優先利用用戶本地 Tunnel (最不容易被 YT 鎖 IP) ──
    try {
        console.log('[v12] Strategy 1: User-Local Tunnel Proxy...');
        const res = await apiRequest('/proxy', { method: 'POST', body: JSON.stringify({ url }), signal });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { console.warn('[v12] Strategy 1 fail:', e.message); }

    // ── 策略 2: Piped API 直連 (Zero-Header GET) ──
    const PIPED_API = 'https://pipedapi.kavin.rocks';
    try {
        console.log('[v12] Strategy 2: Web Mirror (Piped)...');
        // 先嘗試透過 AllOrigins 過濾 CORS
        const pUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`${PIPED_API}/streams/${videoId}`)}`;
        const res = await fetch(pUrl, { signal });
        const raw = await res.json();
        const content = JSON.parse(raw.contents);
        if (content.audioStreams?.[0]?.url) {
            return await _smartMediaFetch(content.audioStreams[0].url, onProgress, signal);
        }
    } catch (e) { console.warn('[v12] Strategy 2 fail:', e.message); }

    throw new Error('自動擷取服務因 YouTube 高強度防護暫時離線。建議手動下載後上傳。');
}

async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    try {
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(12000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }
    // Fallback to media proxy
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
    const res2 = await fetch(proxyUrl, { signal });
    if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);
    throw new Error('媒體存取失敗');
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
    const blob = new Blob(chunks, { type: 'audio/mp4' });
    return new File([blob], defaultName, { type: 'audio/mp4' });
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
