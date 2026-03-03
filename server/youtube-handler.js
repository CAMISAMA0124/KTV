import yts from 'yt-search';
import { create } from 'yt-dlp-exec';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ── Init ─────────────────────────────────────────────────────
// 手動指定路徑，支援 Windows (.exe) 與 Linux (HF Spaces)
const isWin = os.platform() === 'win32';
const YTDLP_PATH = isWin
    ? join(__dirname, '../node_modules/yt-dlp-exec/bin/yt-dlp.exe')
    : join(__dirname, '../node_modules/yt-dlp-exec/bin/yt-dlp');

const ytdlp = create(YTDLP_PATH);

export async function initYtDlp() {
    console.log(`[Server] Local Extraction Engine: BUSY (Checking yt-dlp at ${YTDLP_PATH})`);
    try {
        const version = await ytdlp('', { version: true });
        console.log(`[Server] yt-dlp detected: ${version}`);
        return true;
    } catch (e) {
        console.error('[Server] yt-dlp binary search failed:', e.message);
        return false;
    }
}

// ── Helpers ──────────────────────────────────────────────────

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
        console.error(`[Search] YouTube Search Failed (Probably blocked IP):`, e.message);
        return []; // 返回空陣列以觸發前端的備援模式
    }
}

/** 轉檔 JSON Cookies 為 Netscape 格式 (V36 核心) */
function convertToNetscape(jsonText) {
    try {
        const cookies = JSON.parse(jsonText);
        let netscape = '# Netscape HTTP Cookie File\n\n';
        cookies.forEach(c => {
            const domain = c.domain;
            const includeSubdomains = domain.startsWith('.') ? 'TRUE' : 'FALSE';
            const path = c.path || '/';
            const secure = c.secure ? 'TRUE' : 'FALSE';
            const expiry = Math.floor(c.expirationDate || 0);
            const name = c.name;
            const value = c.value;
            netscape += `${domain}\t${includeSubdomains}\t${path}\t${secure}\t${expiry}\t${name}\t${value}\n`;
        });
        return netscape;
    } catch { return null; }
}

// 擷取音訊 (支援動態 Cookies)
export async function extractAudio(url, cookieData = null) {
    // 核心修正：強制清理 URL，只留下基礎影片連結，避免播放清單 (list=) 導致解析逾時
    const vid = extractVideoId(url);
    const cleanUrl = vid ? `https://www.youtube.com/watch?v=${vid}` : url;

    console.log(`[Handler] Extracting audio: ${cleanUrl} (Original: ${url})`);

    let cookieFile = null;
    const options = {
        dumpSingleJson: true,
        noCheckCertificates: true,
        noWarnings: true,
        addHeader: [
            'referer:https://www.google.com/',
            'user-agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ]
    };

    // 處理 Cookies (V36 增強)
    if (cookieData) {
        const netscape = convertToNetscape(cookieData);
        if (netscape) {
            cookieFile = join(os.tmpdir(), `yt_cookies_${Date.now()}.txt`);
            fs.writeFileSync(cookieFile, netscape);
            options.cookies = cookieFile;
            console.log('[Handler] Using custom user cookies for extraction ✅');
        }
    }

    try {
        const info = await ytdlp(url, options);
        const format = info.formats
            .filter(f => f.vcodec === 'none' && (f.ext === 'm4a' || f.ext === 'webm'))
            .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

        if (!format) throw new Error('No audio format found');
        return { url: format.url, ext: format.ext, title: info.title };
    } catch (e) {
        console.error('[Handler] yt-dlp failed:', e.message);
        throw e;
    } finally {
        // 清理暫存 Cookies 檔
        if (cookieFile && fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);
    }
}




