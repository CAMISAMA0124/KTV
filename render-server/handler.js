/**
 * handler.js
 * YouTube Audio Extraction Logic for Render
 */
import YTDlpWrapPkg from 'yt-dlp-wrap';
const YTDlpWrap = YTDlpWrapPkg.default || YTDlpWrapPkg;
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// yt-dlp binary path
const YTDLP_BINARY = process.platform === 'win32'
    ? path.join(os.tmpdir(), 'yt-dlp.exe')
    : path.join(os.tmpdir(), 'yt-dlp');

let ytDlp = null;

export async function initYtDlp() {
    try {
        // Try to see if it exists
        await fs.access(YTDLP_BINARY);
        ytDlp = new YTDlpWrap(YTDLP_BINARY);
        console.log('[yt-dlp] Existing binary found.');
    } catch {
        console.log('[yt-dlp] Downloading binary to tmp...');
        await YTDlpWrap.downloadFromGithub(YTDLP_BINARY);
        ytDlp = new YTDlpWrap(YTDLP_BINARY);
        // Ensure executable permissions on Linux
        if (process.platform !== 'win32') {
            await fs.chmod(YTDLP_BINARY, 0o755);
        }
    }
    return ytDlp;
}

export async function getVideoInfo(url) {
    return await ytDlp.getVideoInfo(url);
}

export async function searchVideos(query, limit = 5) {
    const result = await ytDlp.execPromise([
        `ytsearch${limit}:${query}`,
        '--dump-json',
        '--no-playlist',
        '--flat-playlist'
    ]);
    const lines = result.trim().split('\n').filter(l => l.trim() !== '');
    return lines.map(line => {
        try {
            const info = JSON.parse(line);
            return {
                id: info.id,
                url: `https://www.youtube.com/watch?v=${info.id}`,
                title: info.title,
                duration: info.duration,
                thumbnail: info.thumbnails?.[0]?.url || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
                uploader: info.uploader || info.channel,
            };
        } catch (e) { return null; }
    }).filter(Boolean);
}

export async function extractAudio(url, onProgress) {
    const info = await getVideoInfo(url);
    const safeTitle = info.title.replace(/[^\w\s-]/g, '').trim().substring(0, 50) || 'audio';
    const tmpPath = path.join(os.tmpdir(), `render_${Date.now()}.m4a`);

    await new Promise((resolve, reject) => {
        const process = ytDlp.exec([
            url,
            '-f', 'ba/b',
            '--no-playlist',
            '--output', tmpPath,
        ]);

        process.on('ytDlpEvent', (eventType, eventData) => {
            if (eventType === 'download' && onProgress) {
                const match = eventData.match(/(\d+(?:\.\d+)?)%/);
                if (match) onProgress(parseFloat(match[1]));
            }
        });

        process.on('close', resolve);
        process.on('error', reject);
    });

    const buffer = await fs.readFile(tmpPath);
    fs.unlink(tmpPath).catch(() => { });
    return { buffer, filename: `${safeTitle}.m4a`, info };
}
