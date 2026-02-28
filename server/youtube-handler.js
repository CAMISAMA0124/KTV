import yts from 'yt-search';

// ── Init ─────────────────────────────────────────────────────
export async function initYtDlp() {
    console.log('[Handler] Mode: SEARCH-ONLY (no backend extraction)');
    return true;
}

// ── Helpers ──────────────────────────────────────────────────

/** 清理 YouTube 縮圖 URL */
function cleanThumbnail(thumb) {
    if (!thumb) return '';
    return thumb.replace('maxresdefault', 'hqdefault');
}

/** 從 URL 提取 video ID */
function extractVideoId(url) {
    const patterns = [/[?&]v=([^&#]+)/, /youtu\.be\/([^?&]+)/, /embed\/([^?&]+)/, /music\.youtube\.com\/watch\?v=([^&#]+)/];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) return m[1];
    }
    return null;
}

// ── API Functions ─────────────────────────────────────────────

/**
 * 取得影片 metadata
 */
export async function getVideoInfo(url) {
    const videoId = extractVideoId(url);
    try {
        const result = await yts({ videoId: videoId || undefined, query: videoId ? undefined : url });
        if (result.title) {
            return {
                id: videoId || result.videoId,
                title: result.title,
                duration: result.seconds || 0,
                thumbnail: cleanThumbnail(result.thumbnail || result.image),
                uploader: result.author?.name || 'YouTube',
            };
        }
        throw new Error('Video not found');
    } catch (e) {
        if (videoId) {
            return { id: videoId || url, title: `YouTube Video`, duration: 0, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, uploader: 'YouTube' };
        }
        throw e;
    }
}

// ── Search ───────────────────────────────────────────────────
export async function searchVideos(query, limit = 8) {
    try {
        const r = await yts(query);
        return (r.videos || []).slice(0, limit).map(v => ({
            id: v.videoId,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            title: v.title,
            duration: v.seconds || 0,
            thumbnail: cleanThumbnail(v.thumbnail || v.image),
            uploader: v.author?.name || 'YouTube',
        }));
    } catch (e) {
        throw new Error('搜尋暫時不可用');
    }
}

/** 擷取音訊 (已搬移至前端) */
export async function extractAudio() {
    throw new Error('Backend extraction disabled for security. Using client-side direct download.');
}


