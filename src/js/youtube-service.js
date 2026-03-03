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

const EXTERNAL_BACKENDS = []; // 移除失效的 Cloudflare 隧道

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

    // 搜尋與詳情：強烈優先走雲端 ('') 以確保搜尋成功率。
    // 下載代理：優先走家中的 config.backend。
    const list = isProxy
        ? [config.backend, config.cloud_backend, '']
        : ['', config.backend, config.cloud_backend];

    let lastError = null;
    for (const base of list) {
        if (base === undefined || base === null) continue;
        try {
            const cleanBase = String(base).replace(/\/$/, '').replace(/\/api$/, '');
            const isLocal = base.includes('loca.lt') || base.includes('127.0.0.1');
            let finalPath = path;

            // 核心：如果是 LocalTunnel，絕對不帶任何標頭，避免 Preflight
            const headers = (isLocal) ? {} : {
                'Accept': 'application/json',
                'X-Youtube-Cookies': config.cookies || '' // V36 傳送身分文件
            };
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

        // 如果後端返回空 (通常是被封鎖)，或是 API 報錯
        if (!data.results || data.results.length === 0) {
            console.warn('Backend search returned no results, service might be limited.');
        }

        return data.results || [];
    } catch (e) {
        console.error('Search API Error:', e);
        return [];
    }
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

/** 3. 下載 (V38: 簡化版 - 備援邏輯移至後端執行) */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // 呼叫後端代理，後端現在會自動嘗試 Cookies -> Cobalt -> Direct
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('audio')) {
        const data = await res.json();
        throw new Error(data.message || '後端暫時無法擷取，請貼上 Cookies 試試。');
    }

    const total = parseInt(res.headers.get('content-length'), 10) || 10000000;
    let loaded = 0;
    const reader = res.body.getReader();
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.length;
        if (onProgress) onProgress((loaded / total) * 100);
    }

    const blob = new Blob(chunks, { type: contentType });
    return new File([blob], `${videoId}.mp3`, { type: contentType });
}

export async function checkAPIHealth() {
    return { ok: true, ready: true };
}
