/**
 * src/js/youtube-service.js
 * (v21 Ultimate Swarm - Multi-Path Resilient Engine)
 * 萬無一失策略：
 * 1. 搜尋 (Search)：由 Vercel 或本地後端負責，因為搜尋不封鎖 IP。
 * 2. 擷取 (Extraction)：由「蜂群引擎」在手機端直接並行分散請求全球鏡像，跳過所有代理 IP 限制。
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

// 蜂群鏡像池
const MIRRORS = [
    'https://inv.vern.cc/api/v1/videos/',
    'https://invidious.nerdvpn.de/api/v1/videos/',
    'https://invidious.privacydev.net/api/v1/videos/',
    'https://pipedapi.lunar.icu/streams/',
    'https://invidious.slipfox.xyz/api/v1/videos/'
];

/** 輔助：提取 Video ID */
function getYouTubeId(url) {
    const m = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|\/shorts\/|watch\?v=)([^"&?\/\s]{11})/);
    return m ? m[1] : null;
}

/** 核心請求引擎 */
async function apiRequest(path, options = {}) {
    const config = EngineConfig.load();
    const list = ['', config.backend, ...EXTERNAL_BACKENDS].filter(b => b !== null && b !== '');

    let lastError = null;
    for (const base of list) {
        try {
            const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
            const isLocalTunnel = base.includes('loca.lt');
            let finalPath = path;

            const headers = { 'Accept': 'application/json', 'Bypass-Tunnel-Reminder': 'true' };
            if (isLocalTunnel && !path.includes('.json')) {
                const [p, q] = path.split('?');
                finalPath = `${p}.json${q ? '?' + q : ''}`;
            }

            const url = base === '' ? `/api${finalPath}` : `${cleanBase}/api${finalPath}`;
            if (options.method === 'POST') headers['Content-Type'] = 'application/json';

            const res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) }, mode: 'cors' });
            if (res.ok) return res;
        } catch (e) { lastError = e; }
    }
    throw lastError || new Error('後端暫時不可用');
}

/** 輸出 1：搜尋歌曲 (這部分後端通常沒問題) */
export async function searchYouTube(query) {
    const res = await apiRequest(`/search?query=${encodeURIComponent(query)}`);
    return await res.json();
}

/** 輸出 2：獲取影片詳情 (蜂群模式) */
export async function fetchVideoInfo(url) {
    const videoId = getYouTubeId(url);
    if (!videoId) throw new Error('網址格式錯誤');

    // 並行向全球站點詢問
    const promises = MIRRORS.map(async mBase => {
        const res = await fetch(`${mBase}${videoId}`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new Error('fail');
        const data = await res.json();
        return {
            id: videoId,
            title: data.title,
            uploader: data.author || data.uploader,
            thumbnail: data.videoThumbnails?.[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            duration: data.lengthSeconds || data.duration
        };
    });

    try {
        return await Promise.any(promises);
    } catch (e) {
        // 如果全球鏡像站都掛了，退回後端處理
        const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
        const data = await res.json();
        return { ...data, id: videoId };
    }
}

/** 輸出 3：核心功能！擷取音檔 (蜂群下載模式) */
export async function extractFromURL(url, onProgress, signal) {
    const videoId = getYouTubeId(url);

    // 步驟 A：尋找可用的音訊流網址
    const getStreamUrl = async () => {
        const promises = MIRRORS.map(async mBase => {
            const res = await fetch(`${mBase}${videoId}`, { signal: AbortSignal.timeout(6000) });
            if (!res.ok) throw new Error('fail');
            const data = await res.json();
            let stream = null;
            if (mBase.includes('piped')) {
                stream = data.audioStreams?.find(f => f.format === 'M4A' || f.format === 'WEBM')?.url;
            } else {
                stream = data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url ||
                    data.formatStreams?.find(f => f.quality === 'medium')?.url;
            }
            if (!stream) throw new Error('no stream');
            return stream;
        });

        try { return await Promise.any(promises); }
        catch (e) {
            // 後端備援
            const res = await apiRequest(`/proxy?url=${encodeURIComponent(url)}`);
            const data = await res.json();
            return data.url;
        }
    };

    const streamUrl = await getStreamUrl();
    if (!streamUrl) throw new Error('無法從全球節點獲取音訊流');

    // 步驟 B：直接從手機端下載二進位音檔
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

/** 輸出 4：健康檢查 */
export async function checkAPIHealth() {
    try {
        const res = await apiRequest('/health', { signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, ready: true };
    } catch (e) {
        return { ok: false, ready: false };
    }
}
