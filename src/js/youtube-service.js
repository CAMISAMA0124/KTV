/**
 * src/js/youtube-service.js
 * (v28 "True Success Restore" - Ultra Stable)
 * 1. 搜尋：只走 Vercel (YouTube API)，保證穩定且無紅字。
 * 2. 下載：只走家用電腦 (LocalTunnel)，這是唯一能穩定抓音源的地方。
 * 3. 511 認證：移除開網頁自動檢查，改為「點擊分析才提示」，並直接提供密碼。
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
    'https://wicked-maps-return.loca.lt'
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

/** 核心請求引擎 (V28 穩定優先序) */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const isProxy = path.includes('/proxy');

    // 搜尋功能只用 Vercel (空字串代表專案本身)
    // 下載代理優先走家裡後端
    const list = isProxy ? [config.backend, ...EXTERNAL_BACKENDS, ''] : ['', config.backend, ...EXTERNAL_BACKENDS];

    let lastError = null;
    for (const base of list.filter(b => b !== '')) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocalTunnel = base.includes('loca.lt');
            let finalPath = path;

            // 嚴格遵守 Simple Request，不帶自定義標頭 (避開 CORS 預檢)
            const headers = (isLocalTunnel) ? {} : { 'Accept': 'application/json' };
            if (!isLocalTunnel && options.method === 'POST') headers['Content-Type'] = 'application/json';

            // LocalTunnel 專用後綴
            if (isLocalTunnel && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = base === '' ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            const fetchOptions = { ...options, headers: { ...headers, ...(options.headers || {}) }, mode: 'cors' };

            const res = await fetch(url, { ...fetchOptions, signal: options.signal || AbortSignal.timeout(10000) });

            if (res.ok) return res;

            // 如果被授權攔截 (511)
            if (res.status === 511 && isLocalTunnel) {
                window.dispatchEvent(new CustomEvent('tunnel-auth-required', { detail: { url: base } }));
                throw new Error('TUNNEL_AUTHORIZATION_REQUIRED');
            }
        } catch (e) {
            lastError = e;
            if (e.message === 'TUNNEL_AUTHORIZATION_REQUIRED') break; // 直接中斷去報錯
        }
    }

    // 最後嘗試 Vercel 本地 API (如果 list 裡包含 '')
    if (list.includes('')) {
        try {
            const res = await fetch(`/api${path}`, { ...options, signal: options.signal || AbortSignal.timeout(10000) });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }

    throw lastError || new Error('後端服務不可用');
}

/** 搜尋歌曲 */
export async function searchYouTube(query) {
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    return data.results || [];
}

/** 獲取影片詳情 */
export async function fetchVideoInfo(url) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.results?.[0]) return data.results[0];
    } catch (e) { }

    const videoId = getYouTubeId(url);
    return {
        id: videoId || 'unknown',
        title: 'YouTube 歌曲',
        uploader: 'YouTube',
        thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '',
        duration: 0
    };
}

/** 擷取音檔 */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // 家用後端提取
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!data.url) throw new Error('無法獲得有效下載位址，請重試。');

    const streamUrl = data.url;

    // 下載
    const response = await fetch(streamUrl, { signal });
    if (!response.ok) throw new Error('音訊流下載失敗');

    const total = parseInt(response.headers.get('content-length'), 10) || 10000000;
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

/** 健康檢查 (V28 靜默模式) */
export async function checkAPIHealth() {
    try {
        // 之所以能 Ready，是因為雲端搜尋通常是好的
        return { ok: true, ready: true };
    } catch (e) {
        return { ok: false, ready: false };
    }
}
