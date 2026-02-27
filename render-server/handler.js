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

// Use system yt-dlp first (pre-installed in Docker)
const SYSTEM_YTDLP = '/usr/local/bin/yt-dlp';
const LOCAL_YTDLP = process.platform === 'win32'
    ? path.join(os.tmpdir(), 'yt-dlp.exe')
    : path.join(os.tmpdir(), 'yt-dlp');

let ytDlp = null;

export async function initYtDlp() {
    try {
        // First try system yt-dlp
        if (process.platform !== 'win32') {
            await fs.access(SYSTEM_YTDLP);
            ytDlp = new YTDlpWrap(SYSTEM_YTDLP);
            console.log('[yt-dlp] Using system binary at', SYSTEM_YTDLP);
            return ytDlp;
        }
    } catch { }

    try {
        // Then try local binary
        await fs.access(LOCAL_YTDLP);
        ytDlp = new YTDlpWrap(LOCAL_YTDLP);
        console.log('[yt-dlp] Using local binary at', LOCAL_YTDLP);
    } catch {
        // Final fallback: download (might fail on some restricted systems)
        console.log('[yt-dlp] No binary found. Downloading to tmp...');
        await YTDlpWrap.downloadFromGithub(LOCAL_YTDLP);
        ytDlp = new YTDlpWrap(LOCAL_YTDLP);
        if (process.platform !== 'win32') {
            await fs.chmod(LOCAL_YTDLP, 0o755);
        }
    }
    try {
        // Daily update check (or on init)
        console.log('[yt-dlp] Checking for updates...');
        await ytDlp.execPromise(['-U']).catch(e => console.log('[yt-dlp] Update skipped:', e.message));
    } catch { }

    return ytDlp;
}

const BYPASS_FLAGS = [
    '--extractor-args', 'youtube:player-client=ios,web',
    '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    '--referer', 'https://www.youtube.com/',
    '--no-cache-dir'
];

export async function getVideoInfo(url) {
    try {
        const result = await ytDlp.execPromise([url, '--dump-json', ...BYPASS_FLAGS]);
        return JSON.parse(result);
    } catch (e) {
        console.error('[yt-dlp] getVideoInfo Error:', e.message);
        throw e;
    }
}

export async function searchVideos(query, limit = 5) {
    return new Promise((resolve, reject) => {
        const q = encodeURIComponent(query);
        const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&maxResults=${limit}&type=video&relevanceLanguage=zh&regionCode=TW&key=${YOUTUBE_API_KEY}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (json.error) {
                        console.error('[YouTube API] Error:', json.error.message);
                        return reject(new Error(json.error.message));
                    }
                    const results = (json.items || []).map(item => ({
                        id: item.id.videoId,
                        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
                        title: item.snippet.title,
                        uploader: item.snippet.channelTitle,
                        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                        duration: 0, // Duration requires separate API call
                    }));
                    resolve(results);
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

export async function extractAudio(url, onProgress) {
    console.log('[Extract]: Starting for', url);
    const info = await getVideoInfo(url);
    const safeTitle = info.title.replace(/[^\w\s-]/g, '').trim().substring(0, 50) || 'audio';
    const tmpPath = path.join(os.tmpdir(), `render_${Date.now()}.m4a`);

    await new Promise((resolve, reject) => {
        const process = ytDlp.exec([
            url,
            '-f', 'ba/b',
            '--no-playlist',
            '--no-part',
            '--no-cache-dir',
            '--force-overwrites',
            '--extractor-args', 'youtube:player-client=ios,web',
            '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
            '--referer', 'https://www.youtube.com/',
            '--output', tmpPath,
        ]);

        process.on('ytDlpEvent', (eventType, eventData) => {
            if (eventType === 'download' && onProgress) {
                const match = eventData.match(/(\d+(?:\.\d+)?)%/);
                if (match) onProgress(parseFloat(match[1]));
            }
        });

        process.on('close', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`yt-dlp exited with code ${code}`));
        });

        process.on('error', (err) => {
            console.error('[yt-dlp] Process Error:', err);
            reject(err);
        });
    });

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
