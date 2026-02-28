/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — (v9 Nuclear Failover)
 * 解決 HTML 污染、CORS 阻斷、API 封鎖，達成真正的「一鍵全自動」
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

async function fetchWithFailover(path, options = {}) {
    const config = EngineConfig.load();
    const list = config.backend ? [config.backend, ...SAME_ORIGIN_API, ...EXTERNAL_BACKENDS] : [...SAME_ORIGIN_API, ...EXTERNAL_BACKENDS];
    const endpoints = [...new Set(list)];
    let lastError = null;

    for (const base of endpoints) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;
            const controller = new AbortController();
            const sid = setTimeout(() => controller.abort(), 8000);

            const res = await fetch(url, {
                ...options,
                headers: { ...options.headers, 'Content-Type': 'application/json' },
                signal: options.signal || controller.signal
            });
            clearTimeout(sid);
            if (res.ok) return res;
            if (res.status === 404) continue; // Skip to next if not implemented
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('後端服務忙碌中');
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
 * 【v9 核心】超強健自動化下載
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // 代理池與解析器
    const PROXIES = [
        (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
        (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`
    ];

    // 獲取並驗證 JSON 的安全函式 (防止 Unexpected Token <)
    const secureJsonGet = async (targetUrl) => {
        for (const proxyFn of PROXIES) {
            try {
                const pUrl = proxyFn(targetUrl);
                console.log(`[v9] Trying Meta-Fetch: ${pUrl}`);
                const res = await fetch(pUrl, { signal: AbortSignal.timeout(6000) });
                if (!res.ok) continue;

                const raw = await res.json();
                // AllOrigins 包裝在 contents，CodeTabs 則直接返回
                const content = raw.contents || (typeof raw === 'string' ? raw : JSON.stringify(raw));

                if (content && content.trim().startsWith('{')) {
                    return JSON.parse(content);
                }
            } catch (e) { console.warn(`[v9] Proxy attempt failed: ${e.message}`); }
        }
        return null;
    };

    // ── 第一波：Piped API (最穩的 GET 源) ──
    const PIPED_INSTANCES = ['https://pipedapi.kavin.rocks', 'https://api.piped.victr.me'];
    for (const base of PIPED_INSTANCES) {
        try {
            const data = await secureJsonGet(`${base}/streams/${videoId}`);
            if (data && data.audioStreams && data.audioStreams.length > 0) {
                const stream = data.audioStreams.find(s => s.format === 'M4A' || s.extension === 'm4a') || data.audioStreams[0];
                console.log('[v9] Success! Stream found via Piped.');
                return await _smartMediaFetch(stream.url, onProgress, signal);
            }
        } catch (e) { }
    }

    // ── 第二波：Invidious API ──
    try {
        const data = await secureJsonGet(`https://inv.vern.cc/api/v1/videos/${videoId}`);
        if (data && data.adaptiveFormats) {
            const stream = data.adaptiveFormats.find(f => f.type.includes('audio/mp4')) || data.adaptiveFormats.find(f => f.type.startsWith('audio'));
            if (stream && stream.url) {
                console.log('[v9] Success! Stream found via Invidious.');
                return await _smartMediaFetch(stream.url, onProgress, signal);
            }
        }
    } catch (e) { }

    // ── 第三波：自己的後端 Proxy (備援) ──
    try {
        onProgress?.(15);
        const res = await fetchWithFailover('/proxy', { method: 'POST', body: JSON.stringify({ url }) });
        const data = await res.json();
        if (data.url) return await _smartMediaFetch(data.url, onProgress, signal);
    } catch (e) { }

    throw new Error('自動化擷取引擎暫時被 YouTube 強力阻截。\n請下載音檔後，點擊「本地音檔分析」手動分析。');
}

/** 獲取媒體 Blob - 支援全自動 Failover */
async function _smartMediaFetch(streamUrl, onProgress, signal) {
    console.log(`[v9] Downloading Media Blob...`);
    onProgress?.(30);
    try {
        // 先直連 (媒體通常沒 CORS)
        const res = await fetch(streamUrl, { signal });
        if (res.ok) return await _readStreamToFile(res, 'audio.m4a', onProgress);
    } catch { }

    // 直連失敗，套用 RAW 代理
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(streamUrl)}`;
    const res2 = await fetch(proxyUrl, { signal });
    if (res2.ok) return await _readStreamToFile(res2, 'audio.m4a', onProgress);

    throw new Error('媒體下載鏈路被切斷');
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

export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch { return false; }
}

export async function checkAPIHealth() {
    try {
        const res = await fetchWithFailover('/health', { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        return { ok: !!data.ok, ready: true };
    } catch { return { ok: false, ready: false }; }
}
