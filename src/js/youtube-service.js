/**
 * src/js/youtube-service.js
 * (v18 Extreme Unified - Anti-Preflight & Client Dominance)
 * 本版焦點：透過 .json URL 後綴完美繞過 LocalTunnel 提醒，徹底消滅 OPTIONS Preflight 預檢請求。
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

/** 
 * 核心請求引擎 (v18)
 * 關鍵：遇到 loca.lt 自動在 path 加上 .json，完全不發送自定義 Header (如 Bypass-Tunnel-Reminder)，
 * 這樣瀏覽器就不會發送 OPTIONS Preflight，完美繞出 CORS 封鎖。
 */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = [...new Set([config.backend, '', ...EXTERNAL_BACKENDS])].filter(b => b !== null && b !== undefined);

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocalTunnel = base.includes('loca.lt');

            // 如果是 loca.lt 且路徑沒有 .json，自動補上以繞過提醒頁面
            let finalPath = path;
            if (isLocalTunnel && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = base === '' ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            console.log(`[v18] API Try: ${url}`);

            const headers = { 'Accept': 'application/json' };
            if (options.method === 'POST') headers['Content-Type'] = 'application/json';

            const fetchOptions = { ...options, headers: { ...headers, ...(options.headers || {}) } };
            // GET 請求嚴格只用 Safe Headers
            if (options.method === 'GET') delete fetchOptions.headers['Content-Type'];

            const res = await fetch(url, { ...fetchOptions, signal: options.signal || AbortSignal.timeout(8000) });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('後端服務不可用');
}

/** 搜尋：穩定 GET 模式 (簡單請求) */
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

/** 【v19 核心】流暢音檔擷取 (依賴 Vercel Backend) */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];
    if (!videoId) throw new Error('無法解析 YouTube 網址');

    // ── 策略 1: 直接透過 V19 Backend Proxy (play-dl / Fallbacks) ──
    try {
        console.log('[v19] Strategy 1: Backend/Tunnel Proxy...');
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`, { method: 'GET', signal });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { console.warn('[v19] Strategy 1 Backend Proxy fail:', e.message); }

    // ── 策略 2: 使用 CORS 代理打 Invidious (備援) ──
    try {
        console.log('[v19] Strategy 2: Mirror via CORS Proxy...');
        const pUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://inv.vern.cc/api/v1/videos/${videoId}`)}`;
        const res = await fetch(pUrl, { signal });
        const raw = await res.json();
        const data = JSON.parse(raw.contents); // AllOrigins wrapper
        const stream = data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url || data.audioStreams?.[0]?.url;
        if (stream) return await _smartMediaFetch(stream, onProgress, signal);
    } catch (e) { }

    throw new Error('擷取失敗: 自動擷取服務因 YouTube 高度防護暫時離線。。您可以試試【複製網址】手動下載後上傳。');
}

async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    // 優先策略：直連獲取 Blob
    try {
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(15000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }

    // 次等策略：透過 CORS 代理下載 (支援跨域，多組備援)
    const PROXIES = [
        `https://corsproxy.io/?url=${encodeURIComponent(streamUrl)}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`
    ];

    for (const proxyUrl of PROXIES) {
        try {
            console.log(`[Media Fetch] Trying CORS Proxy: ${proxyUrl}`);
            const res2 = await fetch(proxyUrl, { signal: AbortSignal.timeout(30000) });
            if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);
        } catch (e) {
            console.warn(`[Media Fetch] Proxy failed: ${e.message}`);
        }
    }

    throw new Error('擷取失敗: 串流下載被阻擋，您可以試試【複製網址】手動下載後上傳。');
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
        if (contentLength && contentLength > 0) {
            onProgress?.(10 + (received / contentLength) * 90);
        } else {
            onProgress?.(10 + Math.min(80, (received / (5 * 1024 * 1024)) * 90)); // fallback progress logic
        }
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
        const res = await apiRequest('/health', { method: 'GET', signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}
