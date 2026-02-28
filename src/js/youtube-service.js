/**
 * src/js/youtube-service.js
 * (v25 "Legacy Restore" - Focused & Simplified)
 * 本版回歸當時成功的邏輯：
 * 1. 優先嘗試本地家用電腦 (透過 LocalTunnel)。
 * 2. 嚴格遵守「簡單請求」規則，絕不發送自定義標頭，以避開 CORS 預檢與隧道攔截。
 * 3. 搜尋功能回歸 Vercel (YouTube API)，這是最穩定的方案。
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

/** 核心基礎：極簡請求 (避開 CORS 與 511) */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = [config.backend, ...EXTERNAL_BACKENDS, ''].filter(b => b !== null && b !== '');

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocalTunnel = base.includes('loca.lt');
            let finalPath = path;

            // 核心：如果是 LocalTunnel，絕對不能有標頭 (避免 Preflight)
            const headers = {};
            if (!isLocalTunnel) {
                headers['Accept'] = 'application/json';
                if (options.method === 'POST') headers['Content-Type'] = 'application/json';
            }

            if (isLocalTunnel && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = base === '' ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;

            const fetchOptions = {
                ...options,
                headers: { ...headers, ...(options.headers || {}) },
                mode: 'cors'
            };

            const res = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(10000) });
            if (res.ok) return res;

            // 如果是 511，代表隧道需要認證
            if (res.status === 511 && isLocalTunnel) {
                console.error('[Tunnel] Authorization Required (511)');
                window.dispatchEvent(new CustomEvent('tunnel-auth-required', { detail: { url: base } }));
            }
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error('後端服務不可用');
}

/** 輸出 1：搜尋歌曲 */
export async function searchYouTube(query) {
    // 搜尋功能 Vercel 或本地都行，Vercel 比較穩 (API Key)
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    return data.results || [];
}

/** 輸出 2：獲取影片詳情 */
export async function fetchVideoInfo(url) {
    const res = await apiRequest(`/search?query=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.results?.[0]) return data.results[0];

    // Fallback info
    const videoId = getYouTubeId(url);
    return {
        id: videoId,
        title: 'YouTube 歌曲 (待解析)',
        uploader: 'YouTube',
        thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
        duration: 0
    };
}

/** 輸出 3：擷取音檔 */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // 優先從本地家用伺服器獲得網址
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!data.url) throw new Error('API 無法解析該影片網址');

    const streamUrl = data.url;

    // 直接從手機端下載
    const response = await fetch(streamUrl, { signal });
    if (!response.ok) throw new Error('音訊流下載中斷');

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

/** 健康檢查 */
export async function checkAPIHealth() {
    try {
        const res = await apiRequest('/health', { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        return { ok: true, ready: data.ytDlpReady !== false };
    } catch (e) {
        return { ok: false, ready: false };
    }
}
