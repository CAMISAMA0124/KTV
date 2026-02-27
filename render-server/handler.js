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
        await fs.access(YTDLP_BINARY);
        ytDlp = new YTDlpWrap(YTDLP_BINARY);
        console.log('[yt-dlp] Existing binary found.');
    } catch {
        console.log('[yt-dlp] Downloading binary to tmp...');
        await YTDlpWrap.downloadFromGithub(YTDLP_BINARY);
        ytDlp = new YTDlpWrap(YTDLP_BINARY);
        if (process.platform !== 'win32') {
            await fs.chmod(YTDLP_BINARY, 0o755);
        }
    }
    return ytDlp;
}

export async function getVideoInfo(url) {
    try {
        return await ytDlp.getVideoInfo(url);
    } catch (e) {
        console.error('[yt-dlp] getVideoInfo Error:', e.message);
        throw e;
    }
}

export async function searchVideos(query, limit = 5) {
    try {
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
    } catch (e) {
        console.error('[yt-dlp] Search Error:', e.message);
        throw e;
    }
}

export async function extractAudio(url, onProgress) {
    console.log('[Extract]: Starting for', url);
    const info = await getVideoInfo(url);
    const safeTitle = info.title.replace(/[^\w\s-]/g, '').trim().substring(0, 50) || 'audio';
    const tmpPath = path.join(os.tmpdir(), `render_${Date.now()}.m4a`);

    await new Promise((resolve, reject) => {
        const process = ytDlp.exec([
            url,
            '-f', 'ba', // Best audio
            '--no-playlist',
            '--no-part', // Avoid issues with .part files
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
