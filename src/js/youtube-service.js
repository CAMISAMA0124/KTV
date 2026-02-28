/**
 * src/js/youtube-service.js
 * (v24 "Smart Hybrid" - Proactive Proxying)
 * 萬無一失策略：
 * 1. 搜尋與詳情：回流後端 (Vercel/Local)。透過代理避開 CORS 地雷。
 * 2. 只有在搜尋失敗時，才啟動前端公共節點備援。
 * 3. 移除所有觸發 Preflight 的標頭。
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

/** 核心基礎：智慧代理請求 */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = ['', config.backend, ...EXTERNAL_BACKENDS].filter(b => b !== null && b !== '');

    // Vercel 優先
    const finalList = ['', ...list];

    let lastError = null;
    for (const base of finalList) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocalTunnel = base.includes('loca.lt');
            let finalPath = path;

            // 嚴禁自定義標頭，確保為過渡 "Simple Request"
            const headers = { 'Accept': 'application/json' };

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

            // GET 請求不帶 Content-Type
            if (!options.method || options.method === 'GET') delete fetchOptions.headers['Content-Type'];

            console.log(`[v24 API] Try: ${url}`);
            const res = await fetch(url, { ...fetchOptions, signal: AbortSignal.timeout(10000) });
            if (res.ok) return res;
        } catch (e) {
            lastError = e;
        }
    }
    throw lastError || new Error('後端服務皆不可用');
}

/** 輸出 1：搜尋歌曲 (回流代理模式) */
export async function searchYouTube(query) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        console.warn('[v24] Backend search failed, using public fallback...');
        // 如果後端掛了，最後一招：用 allorigins 包裹 Invidious
        const mirrored = `https://api.allorigins.win/get?url=${encodeURIComponent('https://inv.vern.cc/api/v1/search?q=' + query + '&type=video')}`;
        const res = await fetch(mirrored);
        const data = await res.json();
        const items = JSON.parse(data.contents);
        return items.slice(0, 10).map(v => ({
            id: v.videoId,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            title: v.title,
            uploader: v.author,
            thumbnail: v.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`,
            duration: v.lengthSeconds
        }));
    }
}

/** 輸出 2：獲取影片詳情 */
export async function fetchVideoInfo(url) {
    try {
        const res = await apiRequest(`/search?query=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (data.results?.[0]) return data.results[0];
        throw new Error('Not found');
    } catch (e) {
        const videoId = getYouTubeId(url);
        return {
            id: videoId,
            title: 'YouTube 歌曲',
            uploader: '系統偵測',
            thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            duration: 0
        };
    }
}

/** 輸出 3：擷取音檔 (智慧備援) */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // A. 優先從後端獲得下載鏈結
    const getLink = async () => {
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        if (!data.url) throw new Error('No link from proxy');
        return data.url;
    };

    let streamUrl;
    try {
        streamUrl = await getLink();
    } catch (e) {
        // 全球強效備援：透過 allorigins 抓取 Invidious 流
        console.warn('[v24] Proxy link failed, using Swarm-Mirror...');
        const mirr = `https://api.allorigins.win/get?url=${encodeURIComponent('https://inv.vern.cc/api/v1/videos/' + videoId)}`;
        const res = await fetch(mirr);
        const data = await res.json();
        const json = JSON.parse(data.contents);
        streamUrl = json.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url;
    }

    if (!streamUrl) throw new Error('無法取得音軌。YouTube 封鎖太強，請手動下載音檔上傳。');

    // B. 下載流程
    const response = await fetch(streamUrl, { signal });
    if (!response.ok) throw new Error('音訊伺服器拒絕手機連線');

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
        return { ok: res.ok, ready: true };
    } catch (e) {
        return { ok: false, ready: false };
    }
}
