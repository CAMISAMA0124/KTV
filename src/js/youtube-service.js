/**
 * src/js/youtube-service.js
 * (v17 Extreme Unified - Client-Side Dominance)
 * 本版焦點：1. 優先在瀏覽器端直連 Cobalt/Piped 避開伺服器 502 2. 徹底解決隧道 Preflight
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
 * 核心請求引擎 (v17)
 * 關鍵：只有 POST 才帶自定義 Header，GET 請求保持「簡單請求」以避開 CORS Preflight
 */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = [...new Set([config.backend, '', ...EXTERNAL_BACKENDS])].filter(b => b);

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;
            console.log(`[v17] API Try: ${url}`);

            const headers = { 'Accept': 'application/json' };

            // 只有遇到本地隧道且是 POST 時才帶 Bypass，
            // GET 請求不帶任何自定義 Header (以免觸發 Preflight)
            if (base.includes('loca.lt') && options.method === 'POST') {
                headers['Bypass-Tunnel-Reminder'] = 'true';
            }
            if (options.method === 'POST') {
                headers['Content-Type'] = 'application/json';
            }

            // 確保 GET 請求不帶 Content-Type
            const fetchOptions = { ...options, headers };
            if (options.method === 'GET') delete fetchOptions.headers['Content-Type'];

            const res = await fetch(url, { ...fetchOptions, signal: options.signal || AbortSignal.timeout(8000) });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('Backend Offline');
}

/** 搜尋：GET 模式 (無 Preflight) */
export async function searchYouTube(query) {
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`, { method: 'GET' });
    return (await res.json()).results || [];
}

export async function fetchVideoInfo(url) {
    const res = await apiRequest(`/info?url=${encodeURIComponent(url)}`, { method: 'GET' });
    return (await res.json()).info;
}

/** 【v17 核心】音軌擷取 - 瀏覽器優先策略 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // ── 策略 1: 瀏覽器直連 Cobalt (最穩定的第三方) ──
    const COBALT_APIS = ['https://api.cobalt.tools/api/json', 'https://co.wuk.sh/api/json'];
    for (const api of COBALT_APIS) {
        try {
            console.log(`[v17] Strategy 1: Direct Client Cobalt -> ${api}`);
            const res = await fetch(api, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true }),
                signal: AbortSignal.timeout(10000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
            }
        } catch (e) { console.warn(`[v17] Direct Cobalt ${api} fail: ${e.message}`); }
    }

    // ── 策略 2: 後端傳接 (Vercel/Local) ──
    try {
        console.log('[v17] Strategy 2: Backend Proxy...');
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`, { method: 'GET', signal });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { console.warn('[v17] Strategy 2 fail:', e.message); }

    // ── 策略 3: 使用 AllOrigins 獲取 Piped JSON ──
    try {
        console.log('[v17] Strategy 3: Piped Mirror via CORS Proxy...');
        const pUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://pipedapi.lunar.icu/streams/${videoId}`)}`;
        const res = await fetch(pUrl, { signal });
        const raw = await res.json();
        const data = JSON.parse(raw.contents);
        if (data.audioStreams?.[0]?.url) {
            return await _smartMediaFetch(data.audioStreams[0].url, onProgress, signal);
        }
    } catch (e) { }

    throw new Error('自動擷取服務因 YouTube 高度防護暫時離線。');
}

async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    // 優先：直連 (音軌通常不會有 CORS)
    try {
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(15000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }

    // 備援：RAW CORS 代理
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
    const res2 = await fetch(proxyUrl, { signal });
    if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);

    throw new Error('流媒體獲取失敗');
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
        // 健康檢查使用 GET (無 Preflight)
        const res = await apiRequest('/health', { method: 'GET', signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}
