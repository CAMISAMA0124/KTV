/**
 * server/youtube-handler.js v2.0
 * YouTube 查詢工具 — 純搜尋，不下載
 * 策略：yt-search (純 JS, 最穩) + 降級搜尋文字解析
 */

import yts from 'yt-search';

// ── Init ─────────────────────────────────────────────────────
export async function initYtDlp() {
    console.log('[Handler] Mode: SEARCH-ONLY (no yt-dlp required)');
    return true;
}

// ── Helpers ──────────────────────────────────────────────────

/** 清理 YouTube 縮圖 URL (移除大小限制) */
function cleanThumbnail(thumb) {
    if (!thumb) return '';
    // 偏好 hqdefault
    if (thumb.includes('maxresdefault')) {
        return thumb.replace('maxresdefault', 'hqdefault');
    }
    return thumb;
}

/** 從 YouTube URL 提取 video ID */
function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
        /[?&]v=([^&#]+)/,
        /youtu\.be\/([^?&]+)/,
        /embed\/([^?&]+)/,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

/** 建立標準 YouTube 影片 URL */
function buildVideoUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
}

// ── Video Info ────────────────────────────────────────────────

/**
 * 取得影片 metadata（透過 URL）
 */
export async function getVideoInfo(url) {
    const videoId = extractVideoId(url);

    // 策略 1: 用 yt-search 搜尋 video ID
    try {
        const idToSearch = videoId || url;
        const result = await yts({ videoId: videoId || undefined, query: videoId ? undefined : url });

        if (result.title) {
            // 直接返回
            return {
                id: videoId || idToSearch,
                title: result.title,
                duration: result.seconds || 0,
                thumbnail: cleanThumbnail(result.thumbnail || result.image),
                uploader: result.author?.name || result.channelTitle || 'YouTube',
            };
        }

        if (result.videos?.length > 0) {
            const v = result.videos[0];
            return {
                id: v.videoId || videoId,
                title: v.title,
                duration: v.seconds || 0,
                thumbnail: cleanThumbnail(v.thumbnail || v.image),
                uploader: v.author?.name || 'YouTube',
            };
        }
        throw new Error('No info found');
    } catch (e) {
        console.error('[Handler] GetInfo Error:', e.message);

        // 策略 2: thumbnail fallback 至少拼一個基本結構
        if (videoId) {
            return {
                id: videoId,
                title: `YouTube 影片 (${videoId})`,
                duration: 0,
                thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
                uploader: 'YouTube',
            };
        }
        throw e;
    }
}

// ── Search ───────────────────────────────────────────────────

/**
 * 搜尋影片 — 多策略備援
 */
export async function searchVideos(query, limit = 8) {
    // 策略 1：直接 yt-search
    try {
        const r = await yts(query);
        if (r.videos && r.videos.length > 0) {
            return r.videos.slice(0, limit).map(v => ({
                id: v.videoId,
                url: buildVideoUrl(v.videoId),
                title: v.title,
                duration: v.seconds || 0,
                thumbnail: cleanThumbnail(v.thumbnail || v.image),
                uploader: v.author?.name || 'YouTube',
            }));
        }
    } catch (e) {
        console.warn('[Handler] yt-search primary failed:', e.message);
    }

    // 策略 2：以更簡短查詢重試
    try {
        const shortQuery = query.split(' ').slice(0, 3).join(' ');
        const r2 = await yts(shortQuery);
        if (r2.videos && r2.videos.length > 0) {
            return r2.videos.slice(0, limit).map(v => ({
                id: v.videoId,
                url: buildVideoUrl(v.videoId),
                title: v.title,
                duration: v.seconds || 0,
                thumbnail: cleanThumbnail(v.thumbnail || v.image),
                uploader: v.author?.name || 'YouTube',
            }));
        }
    } catch (e2) {
        console.error('[Handler] yt-search fallback also failed:', e2.message);
    }

    throw new Error('搜尋功能暫時無法使用，請稍後再試或直接貼上 YouTube 網址。');
}

/**
 * 擷取音訊 (已停用)
 */
export async function extractAudio(url, onProgress) {
    throw new Error('音訊提取功能已停用。請自行下載後上傳本地音檔。');
}
