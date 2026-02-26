/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — 整合搜尋與音訊擷取
 */

const API_BASE = '/api';

/**
 * 搜尋 YouTube 影片
 * @param {string} query
 * @returns {Promise<Array>}
 */
export async function searchYouTube(query) {
    const res = await fetch(`${API_BASE}/search`, {
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
    const res = await fetch(`${API_BASE}/info`, {
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

    const res = await fetch(`${API_BASE}/extract`, {
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
        const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3000) });
        const data = await res.json();
        return data.ok === true;
    } catch {
        return false;
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
