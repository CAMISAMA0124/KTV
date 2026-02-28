/**
 * src/js/youtube-service.js
 * (v27 "Refined Legacy" - Stability First)
 * 萬無一失策略：
 * 1. 搜尋、詳情、健康檢查：優先 Vercel ('')，避開 LocalTunnel 511 報錯與紅字。
 * 2. 音訊下載 (Proxy)：優先家用電腦，因為只有家裡 IP 能抓到音檔。
 * 3. 511 認證：僅在「分析中」被攔截時彈出授權教學與密碼 (1.165.235.235)。
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

/** 核心基礎：極簡請求 (V27 智慧優先序) */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const isProxy = path.includes('/proxy');

    // 家用後端清單
    const homeBackend = [config.backend, ...EXTERNAL_BACKENDS].filter(b => b !== '');
    // 關鍵設定：搜尋優先雲端，下載優先本地
    const list = isProxy ? [...homeBackend, ''] : ['', ...homeBackend];

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocalTunnel = base.includes('loca.lt');
            let finalPath = path;

            // 核心：如果是 LocalTunnel，絕對不能有標頭 (避免 Preflight)
            const headers = (isLocalTunnel) ? {} : { 'Accept': 'application/json' };
            if (!isLocalTunnel && options.method === 'POST') headers['Content-Type'] = 'application/json';

            if (isLocalTunnel && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = base === '' ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            const fetchOptions = { ...options, headers: { ...headers, ...(options.headers || {}) }, mode: 'cors' };

            const res = await fetch(url, { ...fetchOptions, signal: options.signal || AbortSignal.timeout(10000) });
            if (res.ok) return res;

            // 如果下載被 511 擋住，觸發 UI 授權按鈕
            if (res.status === 511 && isLocalTunnel && isProxy) {
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
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
    const data = await res.json();
    return data.results || [];
}

/** 輸出 2：獲取影片詳情 */
export async function fetchVideoInfo(url) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.results?.[0]) return data.results[0];
    } catch (e) { }

    const videoId = getYouTubeId(url);
    return {
        id: videoId || 'unknown',
        title: 'YouTube 影片',
        uploader: 'YouTube',
        thumbnail: videoId ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg` : '',
        duration: 0
    };
}

/** 輸出 3：擷取音檔 */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // 下載代理優先走家裡後端 (因為 Vercel 被 YouTube 封鎖)
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!data.url) throw new Error('API 無法解析該影片網址');

    const streamUrl = data.url;

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
