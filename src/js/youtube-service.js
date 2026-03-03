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

    // 搜尋只用雲端，下載只用家裡 (V36 增強：加上個雲端備援)
    const list = isProxy
        ? [config.backend, config.cloud_backend, ...EXTERNAL_BACKENDS, '']
        : ['', config.backend, config.cloud_backend, ...EXTERNAL_BACKENDS];

    let lastError = null;
    for (const base of list.filter(b => b && b !== '')) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
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

/** 3. 下載 (V34+V37: 加入 Cobalt 用戶端備援) */
async function fetchWithCobalt(url) {
    console.log('[Cobalt] Requesting client-side extraction...');
    const API_URL = 'https://api.cobalt.tools/api/json';
    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({
                url: url,
                vQuality: '720',
                aFormat: 'mp3',
                isAudioOnly: true,
                filenamePattern: 'pretty'
            })
        });
        const data = await response.json();
        if (data.status === 'stream' || data.status === 'redirect') {
            return data.url;
        }
        throw new Error(data.text || 'Cobalt 解析失敗');
    } catch (e) {
        throw new Error('用戶端下載服務暫時不可用，請稍後再試。');
    }
}

export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);
    let blob = null;
    let contentType = 'audio/mpeg';

    try {
        // 優先嘗試：Hugging Face 後端 (如果是連線正常的狀況下)
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
        const cType = res.headers.get('content-type') || '';

        if (!cType.includes('audio')) {
            const data = await res.json();
            throw new Error(data.message || '後端目前被限制');
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
        blob = new Blob(chunks, { type: cType });
        contentType = cType;
    } catch (e) {
        console.warn('[Service] Backend failed, switching to Cobalt client-side strategy...', e.message);

        // 備援：Cobalt 用戶端直連 (解決 IP 被封鎖問題)
        const downloadUrl = await fetchWithCobalt(url);
        const res = await fetch(downloadUrl);
        if (!res.ok) throw new Error('Cobalt 串流取得失敗');

        blob = await res.blob();
        contentType = blob.type;
    }

    return new File([blob], `${videoId}.mp3`, { type: contentType });
}

export async function checkAPIHealth() {
    return { ok: true, ready: true };
}
