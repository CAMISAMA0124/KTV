/**
 * src/js/youtube-service.js
 * (v13 Extreme Unified - Vercel Native Search)
 * 解決 405 (GET/POST) 錯誤，並優先使用穩定的 Vercel 進行搜尋與資訊獲取
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
    'https://ktv-ey9t.onrender.com',
    'https://wicked-maps-return.loca.lt'
];

/** 
 * 核心請求引擎 (v13)
 * 策略：1. 搜尋優先用 Vercel 2. 只有提取才用本地隧道
 */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    // 依序：用戶設定 -> 目前站點 (Vercel) -> 外部節點
    const list = [...new Set([config.backend, '', ...EXTERNAL_BACKENDS])].filter(b => b !== null && b !== undefined);

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;

            // 重要：如果是本地隧道，先判定是否需要跨域 Header
            const isLocalTunnel = base.includes('loca.lt');
            const headers = { 'Accept': 'application/json' };

            // 只有特定路徑才帶 Tunnel Bypass，避免觸發 Preflight
            if (isLocalTunnel && options.method === 'POST') {
                headers['Bypass-Tunnel-Reminder'] = 'true';
            }

            if (options.method === 'POST' && typeof options.body === 'string') {
                headers['Content-Type'] = 'application/json';
            }

            const res = await fetch(url, { ...options, headers, signal: options.signal || AbortSignal.timeout(8000) });

            if (res.ok) return res;
            if (res.status === 405) continue; // 大概是 Method Mismatch，跳過
            if (res.status === 511 && isLocalTunnel) {
                console.warn('[v13] LocalTunnel requires manual auth.');
                continue;
            }
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('後端服務不可用');
}

/** 搜尋：優先用 Vercel，避開隧道 CORS 麻煩 */
export async function searchYouTube(query) {
    // 優先用 GET 模式，Vercel 現在支援了
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`, { method: 'GET' });
    const data = await res.json();
    return data.results || [];
}

export async function fetchVideoInfo(url) {
    const res = await apiRequest(`/info?url=${encodeURIComponent(url)}`, { method: 'GET' });
    const data = await res.json();
    return data.info;
}

/** 【v13 核心】擷取音訊 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // ── 優先嘗試後端代理 (Vercel/Local) ──
    try {
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`, { method: 'GET', signal });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { console.warn('[v13] Proxy fail:', e.message); }

    // ── 備援：Piped Mirror ──
    try {
        const pUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://pipedapi.kavin.rocks/streams/${videoId}`)}`;
        const res = await fetch(pUrl, { signal });
        const raw = await res.json();
        const content = JSON.parse(raw.contents);
        if (content.audioStreams?.[0]?.url) {
            return await _smartMediaFetch(content.audioStreams[0].url, onProgress, signal);
        }
    } catch (e) { }

    throw new Error('自動分析引擎暫時離線。請下載音檔後手動上傳。');
}

async function _smartMediaFetch(streamUrl, onProgress, signal) {
    onProgress?.(30);
    try {
        const res = await fetch(streamUrl, { signal: AbortSignal.timeout(10000) });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
    const res2 = await fetch(proxyUrl, { signal });
    if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);
    throw new Error('媒體讀取失敗');
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
        // 健康檢查優先查 Vercel
        const res = await apiRequest('/health', { method: 'GET', signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}
