/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — 整合搜尋與音訊擷取 (支援雙後端備援)
 */

// Vercel /api routes are same-origin (no CORS, rotating IPs) → always first
// Render is fallback
// ── Engine Engine Config (Ignition System) ──────────────────
export const EngineConfig = {
    load() {
        try {
            const saved = localStorage.getItem('ktv_engine_config');
            return saved ? JSON.parse(saved) : { cookies: '', proxy: '', backend: '' };
        } catch { return { cookies: '', proxy: '', backend: '' }; }
    },
    save(config) {
        localStorage.setItem('ktv_engine_config', JSON.stringify(config));
    },
    clear() {
        localStorage.removeItem('ktv_engine_config');
    },
    getDynamicAPIs() {
        const config = this.load();
        const apis = [];
        if (config.backend) apis.push(config.backend);
        return [...apis, ...SAME_ORIGIN_API, ...EXTERNAL_APIS];
    }
};

const SAME_ORIGIN_API = [''];
const EXTERNAL_APIS = [
    'https://wicked-maps-return.loca.lt', // Default shared colab if alive
    import.meta.env.VITE_API_BASE,
    'https://ktv-ey9t.onrender.com',
].filter(Boolean).map(url => url.replace(/\/$/, '').replace(/\/api$/, ''));

function getEffectiveEndpoints() {
    const config = EngineConfig.load();
    const list = config.backend ? [config.backend] : [];
    const combined = [...list, ...SAME_ORIGIN_API, ...EXTERNAL_APIS];
    return [...new Set(combined)]; // Unique
}

/**
 * 具備備援機制的 Fetch
 */
async function fetchWithFailover(path, options = {}) {
    let lastError = null;

    const endpoints = getEffectiveEndpoints();
    const config = EngineConfig.load();

    for (const base of endpoints) {
        try {
            let url;
            if (base === '') {
                url = `/api${path}`;
            } else if (base.includes('onrender.com') || base.includes('loca.lt')) {
                url = `${base}${path}`;
            } else {
                url = `${base}/api${path}`;
            }
            console.log(`[Failover] Trying: ${url}`);

            const isVercel = base === '';
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), isVercel ? 30000 : 20000);

            const res = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Bypass-Tunnel-Reminder': 'true',
                    'X-Youtube-Cookies': config.cookies || '', // Forward the "Key"
                    'X-Youtube-Proxy': config.proxy || '',   // Forward the "Proxy"
                },
                signal: options.signal || controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                // Trigger failover for server errors, rate limiting, and missing endpoints (404)
                if (res.status === 404 || res.status === 429 || res.status >= 500) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(`端點異常 (HTTP ${res.status}): ${errBody.error || '無法連線'}`);
                }
            }

            return res;
        } catch (e) {
            console.warn(`[Failover] ${base || 'Vercel'} failed: ${e.message}`);
            lastError = e;
        }
    }

    throw new Error(`所有後端服務皆不可用。\n${lastError ? lastError.message : '請檢查網路限制或稍後再試。'}`);
}

/**
 * 搜尋 YouTube 影片
 * @param {string} query
 * @returns {Promise<Array>}
 */
export async function searchYouTube(query) {
    const res = await fetchWithFailover('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '搜尋失敗');
    return data.results;
}

/**
 * 取得 YouTube 影片資訊（若為網址時使用）
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function fetchVideoInfo(url) {
    const res = await fetchWithFailover('/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '無法取得影片資訊');
    return data.info;
}

/**
 * 從 YouTube URL 擷取音訊 → 返回 File 物件
 * 核心策略 (v4 - Hybrid Smart Proxy): 
 * 1. 透過後端 Proxy 呼叫 Cobalt (解決 JSON CORS)
 * 2. 透過 AllOrigins Fetch Blob (解決 Media CORS)
 * 3. 確保 Vercel 背景環境不負擔下載任務，由用戶瀏覽器分流
 * @param {string} url
 * @param {function} onProgress
 * @param {AbortSignal} signal
 * @returns {Promise<File>}
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);

    try {
        console.log('[Extract] Calling Hybrid Cobalt Proxy...');
        // 先透過我們的後端 Proxy 拿到 Cobalt 的下載 JSON
        const proxyRes = await fetchWithFailover('/proxy/cobalt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal
        });

        if (!proxyRes.ok) {
            const err = await proxyRes.json().catch(() => ({}));
            throw new Error(err.message || '無法經由伺服器連線 API');
        }

        const data = await proxyRes.json();
        if (!data.url) throw new Error('API 返回無效網址');

        console.log('[Extract] JSON Success, fetching blob via CORS Proxy...');
        onProgress?.(20);

        // 使用 AllOrigins 繞過媒體檔的 CORS 限制
        // 注意：AllOrigins 的 raw 端點可以直接回傳原始位元組並附加 CORS: *
        const corsProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(data.url)}`;

        const streamRes = await fetch(corsProxyUrl, { signal });
        if (!streamRes.ok) throw new Error('媒體檔下載失敗 (CORS Proxy Error)');

        return await _readStreamToFile(streamRes, 'youtube_audio.mp3', onProgress);

    } catch (e) {
        console.error('[Extract] Hybrid Flow failed:', e.message);
        throw new Error(`一體化服務暫時離線 (ERROR: ${e.message})。\n您可以嘗試使用本地音檔分析。`);
    }
}


/** 串流讀取輔助函式 */
async function _readStreamToFile(response, defaultName, onProgress) {
    const contentLength = +response.headers.get('Content-Length');
    const reader = response.body.getReader();
    let receivedLength = 0;
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (contentLength) {
            const pct = 10 + (receivedLength / contentLength) * 85;
            onProgress?.(pct);
        }
    }

    onProgress?.(100);
    const buffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, position);
        position += chunk.length;
    }

    const titleHeader = response.headers.get('X-Video-Title');
    const title = titleHeader ? decodeURIComponent(titleHeader) : 'audio';
    return new File([buffer], `${title}.${defaultName.split('.').pop()}`, { type: 'audio/mpeg' });
}


export async function checkAPIHealth() {
    try {
        const endpoints = getEffectiveEndpoints();
        for (const base of endpoints) {
            try {
                let url;
                if (base === '') {
                    url = '/api/health';
                } else if (base.includes('onrender.com') || base.includes('loca.lt')) {
                    url = `${base.replace(/\/$/, '')}/health`;
                } else {
                    url = `${base.replace(/\/$/, '')}/api/health`;
                }
                const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
                const data = await res.json();
                if (data.ok || data.status === 'ok') {
                    return { ok: true, ready: true };
                }
            } catch { continue; }
        }
        return { ok: false, ready: false };
    } catch {
        return { ok: false, ready: false };
    }
}

/**
 * 辨識是否為 YouTube 網址
 * @param {string} str 
 * @returns {boolean}
 */
export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch {
        return false;
    }
}
