/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — 整合搜尋與音訊擷取 (Ultimate Hybrid v7)
 * 解決 CORS 阻斷與多重備援
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
    'https://wicked-maps-return.loca.lt',
    'https://ktv-ey9t.onrender.com',
].filter(Boolean).map(url => url.replace(/\/$/, '').replace(/\/api$/, ''));

function getEffectiveEndpoints() {
    const config = EngineConfig.load();
    const list = config.backend ? [config.backend] : [];
    const combined = [...list, ...SAME_ORIGIN_API, ...EXTERNAL_APIS];
    return [...new Set(combined)];
}

async function fetchWithFailover(path, options = {}) {
    let lastError = null;
    const endpoints = getEffectiveEndpoints();
    const config = EngineConfig.load();

    for (const base of endpoints) {
        try {
            let url;
            if (base === '') {
                url = `/api${path}`;
            } else {
                const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
                url = `${cleanBase}/api${path}`;
            }
            console.log(`[Failover] Trying: ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            const res = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Bypass-Tunnel-Reminder': 'true',
                    'X-Youtube-Cookies': config.cookies || '',
                },
                signal: options.signal || controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
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
    throw new Error(`所有後端服務皆不可用。\n${lastError ? lastError.message : '請檢查網路。'}`);
}

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
 * 終極混合擷取引擎 (v7 - Ultimate Proxy + Invidious Fallback)
 * 應對複雜的網頁版 CORS 問題
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);

    const videoIdMatch = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    // ── 策略 1: 公用 Cobalt 實例 (帶 CORS 改進) ──
    const COBALT_INSTANCES = [
        'https://api.cobalt.tools/api/json',
        'https://co.wuk.sh/api/json',
        'https://cobalt.hypertube.xyz/api/json'
    ];

    for (const api of COBALT_INSTANCES) {
        try {
            console.log(`[Extract] Trying Cobalt (JSON): ${api}`);
            const res = await fetch(api, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, aFormat: 'm4a', isAudioOnly: true }),
                signal: AbortSignal.timeout(8000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.url) {
                    onProgress?.(30);
                    return await _fetchMediaAndRead(data.url, 'audio.m4a', onProgress, signal);
                }
            }
        } catch (e) { console.warn(`[Extract] ${api} failed: ${e.message}`); }
    }

    // ── 策略 2: Invidious 實例 (GET 請求，CORS 最友善) ──
    if (videoId) {
        const INVIDIOUS_INSTANCES = [
            'https://yewtu.be',
            'https://iv.melmac.space',
            'https://invidious.sethforprivacy.com',
            'https://inv.vern.cc'
        ];

        for (const base of INVIDIOUS_INSTANCES) {
            try {
                const api = `${base}/api/v1/videos/${videoId}`;
                console.log(`[Extract] Trying Invidious (GET): ${api}`);
                const res = await fetch(api, { signal: AbortSignal.timeout(6000) });
                if (res.ok) {
                    const data = await res.json();
                    // 尋找音訊串流 (格式代碼通常為 140 m4a 128k)
                    const audioStream = data.adaptiveFormats.find(f => f.type.startsWith('audio/mp4')) ||
                        data.adaptiveFormats.find(f => f.type.startsWith('audio'));

                    if (audioStream && audioStream.url) {
                        console.log('[Extract] Success! Audio stream found via Invidious');
                        onProgress?.(30);
                        return await _fetchMediaAndRead(audioStream.url, 'audio.m4a', onProgress, signal);
                    }
                }
            } catch (e) { console.warn(`[Extract] Invidious ${base} failed: ${e.message}`); }
        }
    }

    // ── 策略 3: 使用後端代理 (專門解決 Vercel JSON CORS) ──
    try {
        console.log('[Extract] Using backend proxy...');
        onProgress?.(25);
        const proxyRes = await fetchWithFailover('/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal
        });
        if (proxyRes.ok) {
            const data = await proxyRes.json();
            if (data.url) {
                return await _fetchMediaAndRead(data.url, 'audio.m4a', onProgress, signal);
            }
        }
    } catch (e) {
        console.error('[Extract] All automated flows failed.');
    }

    throw new Error('自動化擷取引擎暫時失效。\n目前 YouTube 防護頻繁更新，請先手動下載後使用「本地音檔分析」。');
}

/** 獲取媒體 Blob 的強健函式 */
async function _fetchMediaAndRead(streamUrl, name, onProgress, signal) {
    try {
        console.log(`[Media] Fetching stream: ${streamUrl}`);
        // 1. 優先直連
        const res = await fetch(streamUrl, { signal });
        if (res.ok) return await _readStreamToFile(res, name, onProgress);
    } catch {
        console.warn('[Media] Direct fetch failed, trying AllOrigins...');
        // 2. 透過 AllOrigins Raw 繞過媒體 CORS
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
        const res2 = await fetch(proxyUrl, { signal });
        if (res2.ok) return await _readStreamToFile(res2, name, onProgress);
    }
    throw new Error('媒體檔讀取失敗 (CORS Error)');
}

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
            const pct = 10 + (receivedLength / contentLength) * 90;
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

    return new File([buffer], defaultName, { type: 'audio/mp4' });
}

export async function checkAPIHealth() {
    try {
        const endpoints = getEffectiveEndpoints();
        for (const base of endpoints) {
            try {
                let url = base === '' ? '/api/health' : `${base.replace(/\/$/, '').replace(/\/api$/, '')}/api/health`;
                const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
                const data = await res.json();
                if (data.ok) return { ok: true, ready: true };
            } catch { continue; }
        }
    } catch { return { ok: false, ready: false }; }
    return { ok: false, ready: false };
}

export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch { return false; }
}
