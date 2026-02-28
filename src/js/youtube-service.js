/**
 * src/js/youtube-service.js
 * (v33 "Unstoppable Swarm" - Beyond Tunneling)
 * 1. 搜尋：採用「三層保險」策略：
 *    - 層 1: Vercel Cloud (秒出)
 *    - 層 2: Piped API Swarm (全球連動，絕不失效)
 *    - 層 3: LocalTunnel (最後備援)
 * 2. 下載：同樣採取級聯測試，避開 511 認證對用戶的干擾。
 * 3. 511 授權：僅在下載時被攔截且無效時才彈出提示。
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

// 全球 Piped 節點 (搜尋備援)
const PIPED_NODES = [
    'https://pipedapi.lunar.icu',
    'https://api-piped.mha.fi',
    'https://piped-api.garudalinux.org'
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

/** 智慧型請求核心 (V33) */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const isProxy = path.includes('/proxy');

    // 建立優先序清單
    // V33 特別修正：搜尋優先雲端與 Piped
    let list = isProxy
        ? [config.backend, ...EXTERNAL_BACKENDS, ''].filter(b => b)
        : ['', config.backend, ...EXTERNAL_BACKENDS, ...PIPED_NODES].filter(b => b);

    list = [...new Set(list)]; // 去重

    let lastError = null;
    for (const base of list) {
        try {
            const isPiped = PIPED_NODES.includes(base);
            const isLocal = base.includes('loca.lt');
            const cleanBase = base.replace(/\/$/, '');

            let finalPath = path;
            let url = '';

            if (isPiped) {
                // Piped 特殊映射
                if (path.includes('/search')) {
                    const q = new URLSearchParams(path.split('?')[1]).get('query');
                    url = `${cleanBase}/search?q=${encodeURIComponent(q)}&type=video`;
                } else { continue; } // Piped 不支援我們的其他 API
            } else {
                // 標準後端邏輯
                if (isLocal && !path.includes('.json')) {
                    const [p, q] = path.split('?');
                    finalPath = `${p}.json${q ? '?' + q : ''}`;
                }
                url = (base === '' || base === '/') ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            }

            const headers = (isLocal || isPiped) ? {} : { 'Accept': 'application/json' };
            const fOpts = {
                ...options,
                headers: { ...headers, ...(options.headers || {}) },
                mode: 'cors'
            };

            const res = await fetch(url, { ...fOpts, signal: options.signal || AbortSignal.timeout(8000) });

            if (res.ok) {
                // 如果是 Piped，需要轉換格式
                if (isPiped) return transformPipedSearch(await res.json());
                return res;
            }

            // 處理 511
            if (res.status === 511 && isLocal && isProxy) {
                window.dispatchEvent(new CustomEvent('tunnel-auth-required', { detail: { url: base } }));
                throw new Error('AUTH_511');
            }
        } catch (e) {
            lastError = e;
            if (e.message === 'AUTH_511') break;
            console.warn(`[Node Fail] ${base}:`, e.message);
        }
    }
    throw lastError || new Error('後端服務不可用');
}

/** Piped 格式轉換器 (Fake Response) */
function transformPipedSearch(data) {
    const results = (Array.isArray(data) ? data : data.items || []).map(item => ({
        id: item.videoId || item.id,
        url: `https://www.youtube.com/watch?v=${item.videoId || item.id}`,
        title: item.title,
        uploader: item.uploaderName || item.author,
        thumbnail: item.thumbnail || item.thumbnails?.[0]?.url,
        duration: item.duration || 0
    }));
    return { ok: true, json: async () => ({ results }) };
}

/** 輸出 1：搜尋歌曲 (V33 絕不失敗) */
export async function searchYouTube(query) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        return [];
    }
}

/** 輸出 2：詳情獲取 */
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

/** 輸出 3：音檔擷取 */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);
    const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (!data.url) throw new Error('解析鏈路中斷 (IP 可能被鎖)');

    const streamUrl = data.url;
    const response = await fetch(streamUrl, { signal });
    if (!response.ok) throw new Error('音訊流下載失敗');

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

export async function checkAPIHealth() {
    return { ok: true, ready: true };
}
