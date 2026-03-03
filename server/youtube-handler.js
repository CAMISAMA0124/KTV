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

/** 伺服器端 Cobalt 備援 (解決 HF IP 封鎖與瀏覽器 CORS 問題) */
async function fetchWithCobaltServerSide(url) {
    console.log('[Handler] Backend switching to Cobalt fallback...');
    try {
        const response = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true })
        });
        const data = await response.json();
        if (data.status === 'stream' || data.status === 'redirect') return data.url;
    } catch (e) {
        console.error('[Handler] Cobalt API unreachable:', e.message);
    }
    return null;
}

// 擷取音訊 (V38: Server-side Hybrid Strategy)
export async function extractAudio(url, cookieData = null) {
    // 強制清理 URL，避免播放清單 (list=) 導致解析逾時
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

    // 策略 A: 如果使用者提供 Cookies，優先用 yt-dlp (最穩定)
    if (cookieData) {
        const netscape = convertToNetscape(cookieData);
        if (netscape) {
            try {
                cookieFile = join(os.tmpdir(), `yt_cookies_${Date.now()}.txt`);
                fs.writeFileSync(cookieFile, netscape);
                options.cookies = cookieFile;
                console.log('[Handler] Using custom cookies with yt-dlp...');

                const info = await ytdlp(cleanUrl, options);
                const format = info.formats
                    .filter(f => f.vcodec === 'none' && (f.ext === 'm4a' || f.ext === 'webm'))
                    .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];

                if (format) return { url: format.url, ext: format.ext, title: info.title };
            } catch (e) {
                console.warn('[Handler] yt-dlp with cookies failed:', e.message);
            } finally {
                if (cookieFile && fs.existsSync(cookieFile)) fs.unlinkSync(cookieFile);
            }
        }
    }

    // 策略 B: 使用第三方服務備援 (Cobalt) - 由伺服器發起，繞過 CORS
    const cobaltUrl = await fetchWithCobaltServerSide(cleanUrl);
    if (cobaltUrl) {
        console.log('[Handler] Cobalt extraction SUCCESS ✅');
        return { url: cobaltUrl, ext: 'mp3', title: 'YouTube Audio' };
    }

    // 策略 C: 最後嘗試原始 yt-dlp (純靠運氣)
    try {
        console.log('[Handler] Trying default yt-dlp...');
        const info = await ytdlp(cleanUrl, { dumpSingleJson: true, noCheckCertificates: true });
        const format = info.formats.filter(f => f.vcodec === 'none').sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
        if (format) return { url: format.url, ext: format.ext, title: info.title };
    } catch (e) {
        throw new Error('所有下載策略皆失敗，建議貼上 YouTube Cookies。');
    }
}




