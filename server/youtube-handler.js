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
    let videoId = extractVideoId(url);
    if (!videoId && /^[a-zA-Z0-9_-]{11}$/.test(url)) videoId = url;

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
        let videoId = extractVideoId(query);
        if (!videoId && /^[a-zA-Z0-9_-]{11}$/.test(query)) videoId = query;

        if (videoId) {
            // 這個網址包含具體的 Video ID，我們不要進行「關鍵字搜尋」，直接回傳該單一影片
            console.log(`[Search] Direct URL detected, fetching info for ID: ${videoId}`);
            const info = await getVideoInfo(videoId);
            if (info && info.id) {
                return [{
                    id: info.id,
                    url: `https://www.youtube.com/watch?v=${info.id}`,
                    title: info.title,
                    uploader: info.uploader,
                    thumbnail: info.thumbnail,
                    duration: info.duration
                }];
            }
        }

        // 關鍵字搜尋模式
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


