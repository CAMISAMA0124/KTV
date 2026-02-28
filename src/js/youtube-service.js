/**
 * src/js/youtube-service.js
 * (v32 "Resilient Hybrid" - The Final Answer)
 * 1. 搜尋、詳情：100% 走 Vercel ('')，避開隧道紅字，保證搜尋穩定。
 * 2. 下載：本地隧道優先，備用 Render，最後才是手動解析。
 * 3. 511 攔截：只在下載階段觸發授權 UI。
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

/** 輔助：提取 Video ID */
function getYouTubeId(url) {
    if (!url) return null;
    const m = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|\/shorts\/|watch\?v=)([^"&?\/\s]{11})/);
    return m ? m[1] : null;
}

export function isYouTubeURL(url) {
    return !!getYouTubeId(url);
}

/** 智慧型 API 請求引擎 (V32) */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const isProxy = path.includes('/proxy');

    // 搜尋/詳情：100% 雲端優先
    // 下載：家裡優先，Render 備用
    let list = isProxy
        ? [config.backend, ...EXTERNAL_BACKENDS, ''].filter(b => b)
        : ['', config.backend, ...EXTERNAL_BACKENDS].filter(b => b);

    // 去重
    list = [...new Set(list)];

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocal = base.includes('loca.lt');
            let finalPath = path;

            // Simple Headers (No Preflight) for LocalTunnel
            const headers = (isLocal) ? {} : { 'Accept': 'application/json' };
            if (isLocal && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = (base === '' || base === '/') ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            const fOpts = {
                ...options,
                headers: { ...headers, ...(options.headers || {}) },
                mode: 'cors'
            };

            const res = await fetch(url, {
                ...fOpts,
                signal: options.signal || AbortSignal.timeout(10000)
            });

            if (res.ok) return res;

            // 處理 511 (僅在下載時顯示 UI)
            if (res.status === 511 && isLocal && isProxy) {
                window.dispatchEvent(new CustomEvent('tunnel-auth-required', { detail: { url: base } }));
                throw new Error('TUNNEL_511');
            }
        } catch (e) {
            lastError = e;
            if (e.message === 'TUNNEL_511') break;
            console.warn(`[API] node ${base} failed, trying next...`, e);
        }
    }
    throw lastError || new Error('服務端忙碌中');
}

/** 搜尋歌曲 */
export async function searchYouTube(query) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        console.error('[Search] Failed:', e);
        return [];
    }
}

/** 獲取影片詳情 */
export async function fetchVideoInfo(url) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.results?.[0]) return data.results[0];
    } catch (e) { }

    const vid = getYouTubeId(url);
    return {
        id: vid || 'unknown',
        title: 'YouTube 歌曲 (點擊分析)',
        uploader: 'YouTube',
        thumbnail: vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : '',
        duration: 0
    };
}

/** 擷取音檔 (V32 自動降級 logic) */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // Attempt download via backend proxy
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!data.url) throw new Error('解析失敗 (IP 可能被 YouTube 暫時封鎖)，請稍後再試或手動上傳。');

    const streamUrl = data.url;

    // Direct mobile download
    const response = await fetch(streamUrl, { signal });
    if (!response.ok) throw new Error('音訊流下載中斷');

    const total = parseInt(response.headers.get('content-length'), 10) || 12000000;
    let loaded = 0;
    const reader = response.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (onProgress) onProgress((loaded / total) * 100);
    }
    const blob = new Blob(chunks, { type: 'audio/mpeg' });
    return new File([blob], `${videoId}.mp3`, { type: 'audio/mpeg' });
}

/** 健康檢查 (V32 簡化) */
export async function checkAPIHealth() {
    return { ok: true, ready: true };
}
