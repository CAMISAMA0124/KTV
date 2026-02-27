/**
 * handler.js
 * YouTube Audio Extraction Logic for Render
 */
import YTDlpWrapPkg from 'yt-dlp-wrap';
const YTDlpWrap = YTDlpWrapPkg.default || YTDlpWrapPkg;
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import https from 'https';

const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyBBZzotQ2jYfdyqrZNhKcO-1AoGS5vI76k';
const YOUTUBE_COOKIES = process.env.YOUTUBE_COOKIES || '';

const LOCAL_YTDLP = process.platform === 'win32'
    ? path.join(os.tmpdir(), 'yt-dlp.exe')
    : path.join(os.tmpdir(), 'yt-dlp');

let ytDlp = null;

export async function initYtDlp() {
    try {
        console.log('[yt-dlp] Downloading latest binary from GitHub...');
        await YTDlpWrap.downloadFromGithub(LOCAL_YTDLP);
        if (process.platform !== 'win32') {
            await fs.chmod(LOCAL_YTDLP, 0o755);
        }
        ytDlp = new YTDlpWrap(LOCAL_YTDLP);
        console.log('[yt-dlp] Latest binary ready.');
    } catch (e) {
        console.warn('[yt-dlp] Download failed, trying system version:', e.message);
        ytDlp = new YTDlpWrap('/usr/local/bin/yt-dlp');
    }
    return ytDlp;
}

const FALLBACK_CLIENTS = [
    'tv,web',
    'android,ios',
    'ios,web',
    'tvhtml5'
];

// Helper to prepare cookies file (converts JSON to Netscape format if needed)
async function getCookiesFile() {
    if (!YOUTUBE_COOKIES) return null;
    let content = YOUTUBE_COOKIES.trim();

    // Check if it's JSON
    if (content.startsWith('[') && content.endsWith(']')) {
        try {
            const json = JSON.parse(content);
            const netscape = json.map(c => {
                const domain = c.domain || '';
                const flag = domain.startsWith('.') ? 'TRUE' : 'FALSE';
                const path = c.path || '/';
                const secure = c.secure ? 'TRUE' : 'FALSE';
                const expiry = Math.floor(c.expirationDate || 0);
                const name = c.name || '';
                const value = c.value || '';
                return `${domain}\t${flag}\t${path}\t${secure}\t${expiry}\t${name}\t${value}`;
            }).join('\n');
            content = `# Netscape HTTP Cookie File\n${netscape}`;
        } catch (e) {
            console.error('[Cookies] JSON Parse Error:', e.message);
        }
    }

    const cookiePath = path.join(os.tmpdir(), `yt_cookies_${Date.now()}.txt`);
    await fs.writeFile(cookiePath, content);
    return cookiePath;
}

export async function getVideoInfo(url) {
    let lastError = null;
    const cookiePath = await getCookiesFile();
    const cookieFlags = cookiePath ? ['--cookies', cookiePath] : [];

    // If we have cookies, start with default (web) as forced clients often break cookies
    const clients = cookiePath ? [null] : FALLBACK_CLIENTS;

    for (const client of clients) {
        try {
            console.log(`[yt-dlp] Trying getVideoInfo with client: ${client || 'default'} (Cookies: ${!!cookiePath})`);
            const args = [
                url, '--dump-json', '--no-cache-dir',
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...cookieFlags
            ];
            if (client) args.push('--extractor-args', `youtube:player-client=${client}`);

            const result = await ytDlp.execPromise(args);
            if (cookiePath) await fs.unlink(cookiePath).catch(() => { });
            return JSON.parse(result);
        } catch (e) {
            console.warn(`[yt-dlp] Client ${client || 'default'} failed:`, e.message);
            lastError = e;
        }
    }
    if (cookiePath) await fs.unlink(cookiePath).catch(() => { });
    throw lastError;
}

function ytApiGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
        }).on('error', reject);
    });
}

function isoToSecs(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

export async function searchVideos(query, limit = 5) {
    const q = encodeURIComponent(query);
    const searchData = await ytApiGet(`https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&maxResults=${limit}&type=video&relevanceLanguage=zh&regionCode=TW&key=${YOUTUBE_API_KEY}`);
    if (searchData.error) throw new Error(searchData.error.message);
    const items = searchData.items || [];
    if (items.length === 0) return [];

    // Fetch durations
    const ids = items.map(i => i.id.videoId).join(',');
    const detailData = await ytApiGet(`https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${YOUTUBE_API_KEY}`);
    const durMap = {};
    (detailData.items || []).forEach(v => { durMap[v.id] = isoToSecs(v.contentDetails?.duration); });

    return items.map(item => ({
        id: item.id.videoId,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        title: item.snippet.title,
        uploader: item.snippet.channelTitle,
        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
        duration: durMap[item.id.videoId] || 0,
    }));
}

export async function extractAudio(url, onProgress) {
    console.log('[Extract]: Starting for', url);
    const info = await getVideoInfo(url);
    const safeTitle = info.title.replace(/[^\w\s-]/g, '').trim().substring(0, 50) || 'audio';
    const tmpPath = path.join(os.tmpdir(), `render_${Date.now()}.m4a`);

    const cookiePath = await getCookiesFile();
    const cookieFlags = cookiePath ? ['--cookies', cookiePath] : [];
    const clients = cookiePath ? [null] : FALLBACK_CLIENTS;

    for (const client of clients) {
        try {
            console.log(`[Extract] Trying client: ${client || 'default'} (Cookies: ${!!cookiePath})`);
            await new Promise((resolve, reject) => {
                const args = [
                    url,
                    '-f', 'ba/b',
                    '--no-playlist', '--no-part', '--no-cache-dir', '--force-overwrites',
                    '--output', tmpPath,
                    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    ...cookieFlags
                ];
                if (client) args.push('--extractor-args', `youtube:player-client=${client}`);

                const process = ytDlp.exec(args);
                let lastOutput = '';

                process.on('ytDlpEvent', (eventType, eventData) => {
                    lastOutput = eventData;
                    if (eventType === 'download' && onProgress) {
                        const match = eventData.match(/(\d+(?:\.\d+)?)%/);
                        if (match) onProgress(parseFloat(match[1]));
                    }
                });

                process.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`yt-dlp exited with code ${code}. Last: ${lastOutput}`));
                });

                process.on('error', reject);
            });
            success = true;
            break;
        } catch (e) {
            console.warn(`[Extract] Client ${client} failed:`, e.message);
        }
    }

    if (!success) throw new Error('所有擷取方式皆已失敗，YouTube 可能封鎖了此 IP');

    try {
        const buffer = await fs.readFile(tmpPath);
        fs.unlink(tmpPath).catch(() => { });
        console.log('[Extract]: Success');
        return { buffer, filename: `${safeTitle}.m4a`, info };
    } catch (e) {
        console.error('[Extract]: Post-processing Error:', e);
        throw e;
    }
}
