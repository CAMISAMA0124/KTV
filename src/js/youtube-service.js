/**
 * src/js/youtube-service.js
 * (v31 "The Revert" - Focused Logic)
 * 1. 搜尋、詳情：100% 只走 Vercel ('')，避開隧道紅字。
 * 2. 下載：只走家用電腦 (LocalTunnel)，因為家裡 IP 到 YouTube 最穩定。
 * 3. 511 認證：移除頻繁檢查，僅在下載被攔截時觸發 UI。
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
    'https://latina-teacher-pgp-sierra.trycloudflare.com'
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

/** 基礎請求引擎 (V31 簡化版) */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const isProxy = path.includes('/proxy');

    // 搜尋只用雲端，下載只用家裡
    const list = isProxy ? [config.backend, ...EXTERNAL_BACKENDS, ''] : ['', config.backend, ...EXTERNAL_BACKENDS];

    let lastError = null;
    for (const base of list.filter(b => b !== '')) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocal = base.includes('loca.lt');
            let finalPath = path;

            // 核心：如果是 LocalTunnel，絕對不帶任何標頭，避免 Preflight
            const headers = (isLocal) ? {} : { 'Accept': 'application/json' };
            if (isLocal && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = base === '' ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            const fOpts = { ...options, headers: { ...headers, ...(options.headers || {}) }, mode: 'cors' };

            const res = await fetch(url, { ...fOpts, signal: options.signal || AbortSignal.timeout(10000) });

            if (res.ok) return res;

            // 511 認證攔截
            if (res.status === 511 && isLocal) {
                window.dispatchEvent(new CustomEvent('tunnel-auth-required', { detail: { url: base } }));
                throw new Error('TUNNEL_511');
            }
        } catch (e) {
            lastError = e;
            if (e.message === 'TUNNEL_511') break;
        }
    }

    // 如果 list 中包含空字串，最後試一次 Vercel
    if (list.includes('')) {
        try {
            const res = await fetch(`/api${path}`, { ...options, signal: options.signal || AbortSignal.timeout(10000) });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }

    throw lastError || new Error('服務端忙碌');
}

/** 1. 搜尋 */
export async function searchYouTube(query) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.results || [];
    } catch (e) { return []; }
}

/** 2. 詳情 */
export async function fetchVideoInfo(url) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.results?.[0]) return data.results[0];
    } catch (e) { }

    const vid = getYouTubeId(url);
    return {
        id: vid || 'unknown',
        title: 'YouTube 歌曲',
        uploader: 'YouTube',
        thumbnail: vid ? `https://img.youtube.com/vi/${vid}/hqdefault.jpg` : '',
        duration: 0
    };
}

/** 3. 下載 */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!data.url) throw new Error('解析鏈路失敗，請嘗試手動登入隧道。');

    const response = await fetch(data.url, { signal });
    if (!response.ok) throw new Error('影片載入中斷');

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

export async function checkAPIHealth() {
    return { ok: true, ready: true };
}
