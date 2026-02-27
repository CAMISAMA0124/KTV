/**
 * handler.js
 * YouTube Audio Extraction Logic for Render
 */
import YTDlpWrapPkg from 'yt-dlp-wrap';
const YTDlpWrap = YTDlpWrapPkg.default || YTDlpWrapPkg;
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

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
        // Using -J for faster dump-json
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
            '-f', 'ba',
            '--no-playlist',
            '--no-part',
            '--no-cache-dir',
            '--force-overwrites',
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
