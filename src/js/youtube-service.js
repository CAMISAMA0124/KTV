/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — 整合搜尋與音訊擷取 (支援雙後端備援)
 */

const API_ENDPOINTS = [
    import.meta.env.VITE_API_BASE || 'https://camisama-ktv.zeabur.app/api',
    'https://ktv.zeabur.app/api'
];

/**
 * 具備備援機制的 Fetch
 */
async function fetchWithFailover(path, options = {}) {
    let lastError = null;

    for (const base of API_ENDPOINTS) {
        if (!base || base === '/api') {
            // 如果是本地開發或未定義則跳過
            if (base === '/api' && API_ENDPOINTS.length > 1 && !window.location.hostname.includes('localhost')) continue;
        }

        try {
            console.log(`[Failover] Trying API: ${base}${path}`);
            const res = await fetch(`${base}${path}`, options);

            // 如果是 500 以上的錯誤或 429 (流量限制)，考慮換下一個
            if (!res.ok && (res.status >= 500 || res.status === 429)) {
                throw new Error(`API_ERROR_${res.status}`);
            }

            return res;
        } catch (e) {
            console.warn(`[Failover] ${base} failed: ${e.message}`);
            lastError = e;
            // 繼續嘗試下一個 base
        }
    }

    throw lastError || new Error('所有後端服務皆不可用');
}

/**
 * 搜尋 YouTube 影片
 * @param {string} query
 * @returns {Promise<Array>}
 */
export async function searchYouTube(query) {
    const res = await fetchWithFailover('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '搜尋失敗');
    return data.results;
}

/**
 * 取得 YouTube 影片資訊（若為網址時使用）
 * @param {string} url
 * @returns {Promise<object>}
 */
export async function fetchVideoInfo(url) {
    const res = await fetchWithFailover('/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '無法取得影片資訊');
    return data.info;
}

/**
 * 從 YouTube URL 擷取音訊 → 返回 File 物件
 * @param {string} url
 * @param {function} onProgress - (pct: 0-100) => void
 * @param {AbortSignal} signal
 * @returns {Promise<File>}
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);

    const res = await fetchWithFailover('/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
        signal,
    });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
    }

    onProgress?.(80);

    // 取得檔案名稱
    const titleHeader = res.headers.get('X-Video-Title');
    const title = titleHeader ? decodeURIComponent(titleHeader) : 'youtube_audio';
    const filename = `${title}.m4a`;

    const buffer = await res.arrayBuffer();
    onProgress?.(100);

    return new File([buffer], filename, { type: 'audio/mp4' });
}

/**
 * 檢查後端 API 是否可用
 * @returns {Promise<boolean>}
 */
export async function checkAPIHealth() {
    try {
        for (const base of API_ENDPOINTS) {
            try {
                // Remove trailing slash if exists to avoid double //
                const cleanBase = base.replace(/\/$/, '');
                const res = await fetch(`${cleanBase}/health`, { signal: AbortSignal.timeout(3000) });
                const data = await res.json();
                if (data.ok || data.status === 'ok') {
                    return { ok: true, ready: !!data.ready };
                }
            } catch { continue; }
        }
        return { ok: false, ready: false };
    } catch {
        return { ok: false, ready: false };
    }
}

/**
 * 辨識是否為 YouTube 網址
 * @param {string} str 
 * @returns {boolean}
 */
export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch {
        return false;
    }
}
