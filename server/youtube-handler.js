import yts from 'yt-search';

// Dummy init since yt-search requires no setup
export async function initYtDlp() {
    console.log('[yt-search] Using pure JS YouTube search engine');
    return true;
}

/**
 * 取得影片 metadata
 */
export async function getVideoInfo(url) {
    try {
        const video = await yts(url);
        if (!video.videos || video.videos.length === 0) {
            if (video.title) {
                return {
                    title: video.title,
                    duration: video.seconds || 0,
                    thumbnail: video.thumbnail || video.image,
                    uploader: video.author?.name || 'YouTube',
                };
            }
            throw new Error('No info found');
        }
        const v = video.videos[0];
        return {
            title: v.title,
            duration: v.seconds,
            thumbnail: v.thumbnail || v.image,
            uploader: v.author?.name || 'YouTube',
        };
    } catch (e) {
        console.error('[Search] GetInfo Error:', e.message);
        throw e;
    }
}

/**
 * 搜尋影片
 */
export async function searchVideos(query, limit = 5) {
    try {
        const r = await yts(query);
        const videos = r.videos.slice(0, limit);
        return videos.map(v => ({
            id: v.videoId,
            url: v.url,
            title: v.title,
            duration: v.seconds,
            thumbnail: v.thumbnail || v.image,
            uploader: v.author?.name || 'YouTube',
        }));
    } catch (e) {
        console.error('[Search] Parse Error:', e.message);
        throw e;
    }
}

/**
 * 擷取音訊 (Disabled)
 */
export async function extractAudio(url, onProgress) {
    throw new Error('Extract audio has been disabled on backend. Please use frontend local analysis.');
}
