/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — (v8 Ultimate - Pure Client-Side Proxy)
 * 解決所有 CORS 與 502/404 問題，達成真正的「一鍵全自動」
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

function getEffectiveEndpoints() {
    const config = EngineConfig.load();
    const top = config.backend ? [config.backend] : [];
    return [...new Set([...top, ...SAME_ORIGIN_API, ...EXTERNAL_BACKENDS])];
}

async function fetchWithFailover(path, options = {}) {
    const endpoints = getEffectiveEndpoints();
    let lastError = null;

    for (const base of endpoints) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const url = base === '' ? `/api${path}` : `${cleanBase}/api${path}`;
            console.log(`[Failover] Trying: ${url}`);

            const controller = new AbortController();
            const sid = setTimeout(() => controller.abort(), 10000);

            const res = await fetch(url, {
                ...options,
                headers: { ...options.headers, 'Bypass-Tunnel-Reminder': 'true' },
                signal: options.signal || controller.signal
            });
            clearTimeout(sid);
            if (res.ok) return res;
        } catch (e) {
            lastError = e;
            console.warn(`[Failover] Backend ${base} failed: ${e.message}`);
        }
    }
    throw lastError || new Error('後端暫時不可用');
}

export async function searchYouTube(query) {
    const res = await fetchWithFailover('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const data = await res.json();
    return data.results || [];
}

export async function fetchVideoInfo(url) {
    const res = await fetchWithFailover('/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const data = await res.json();
    return data.info;
}

/**
 * 【v8 核心】超強健擷取引擎
 * 完全依賴公用 GET 代理，繞過所有 CORS 攔截
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // 鏡像站池 (這些站點 API 較穩定)
    const INVIDIOUS_INSTANCES = [
        'https://inv.vern.cc',
        'https://invidious.asir.dev',
        'https://yewtu.be',
        'https://iv.melmac.space'
    ];

    console.log('[Extract] Starting v8 Pure Proxy Flow...');

    // ── 第一階段：獲取下載連結 (透過 AllOrigins 代理 GET，100% 避開 CORS) ──
    for (const base of INVIDIOUS_INSTANCES) {
        try {
            const targetApi = `${base}/api/v1/videos/${videoId}?fields=adaptiveFormats,title`;
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetApi)}`;

            console.log(`[Extract] Trying Invidious via Proxy: ${base}`);
            const res = await fetch(proxyUrl, { signal });
            if (!res.ok) continue;

            const proxyData = await res.json();
            const videoData = JSON.parse(proxyData.contents); // AllOrigins 包裝在 contents 裡

            // 尋找音訊軌 (優先找 m4a/mp4)
            const formats = videoData.adaptiveFormats || [];
            const audio = formats.find(f => f.type.includes('audio/mp4')) || formats.find(f => f.type.startsWith('audio'));

            if (audio && audio.url) {
                console.log('[Extract] Found stream URL, downloading blob...');
                onProgress?.(30);

                // ── 第二階段：下載音軌 (再次透過 AllOrigins 繞過媒體跨域) ──
                const mediaProxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(audio.url)}`;
                const mediaRes = await fetch(mediaProxyUrl, { signal });

                if (mediaRes.ok) {
                    return await _readStreamToFile(mediaRes, 'youtube_audio.m4a', onProgress);
                }
            }
        } catch (e) {
            console.warn(`[Extract] Strategy failed for ${base}:`, e.message);
        }
    }

    // ── 最終備援：如果公用代理全掛，嘗試自己的雲端 Proxy ──
    try {
        console.log('[Extract] Last resort: Backend Proxy...');
        const res = await fetchWithFailover('/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal
        });
        if (res.ok) {
            const data = await res.json();
            if (data.url) {
                const finalRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(data.url)}`, { signal });
                return await _readStreamToFile(finalRes, 'audio.m4a', onProgress);
            }
        }
    } catch (e) { }

    throw new Error('自動擷取服務因 YouTube 高強度防護暫時離線。\n請下載影片後，使用「本地音檔分析」按鈕處理。');
}

/** 串流下載輔助 */
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
            const pct = 10 + (received / contentLength) * 90;
            onProgress?.(Math.min(99, pct));
        }
    }

    onProgress?.(100);
    const blob = new Blob(chunks, { type: 'audio/mp4' });
    return new File([blob], defaultName, { type: 'audio/mp4' });
}

export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch { return false; }
}
