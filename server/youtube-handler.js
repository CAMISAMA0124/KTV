/**
 * server/youtube-handler.js
 * YouTube 音訊擷取 — 使用 yt-dlp-wrap
 */

import YTDlpWrapPkg from 'yt-dlp-wrap';
const YTDlpWrap = YTDlpWrapPkg.default || YTDlpWrapPkg;
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

// yt-dlp binary 路徑設定
const YTDLP_BINARY = process.platform === 'win32'
    ? path.join(os.tmpdir(), 'yt-dlp.exe')
    : '/usr/local/bin/yt-dlp'; // Docker 內建路徑

// FFmpeg fallback paths (常見應用程式附帶的 ffmpeg 或本地 bin)
const FFMPEG_FALLBACKS = [
    path.resolve('bin/ffmpeg.exe'),
    path.join(os.homedir(), 'AppData/Local/LINE/Data/plugin/ffmpeg/1.0.0.5/ffmpeg.exe'),
];

let ytDlp = null;
let ffmpegPath = 'ffmpeg'; // 預設使用系統 PATH

/**
 * 偵測有效語 ffmpeg 路徑
 */
async function detectFFmpeg() {
    // 1. 測試本地 bin 或 fallback 路徑
    for (const fb of FFMPEG_FALLBACKS) {
        try {
            await fs.access(fb);
            console.log('[FFmpeg] Found in priority path:', fb);
            return fb;
        } catch { }
    }

    // 2. 測試系統 PATH
    try {
        const { execSync } = await import('child_process');
        execSync('ffmpeg -version', { stdio: 'ignore' });
        console.log('[FFmpeg] Found in system PATH');
        return 'ffmpeg';
    } catch (e) { }

    console.warn('[FFmpeg] NOT FOUND. YouTube extraction will fail.');
    return null;
}

/**
 * 初始化 yt-dlp（若 binary 不存在則自動下載）
 */
export async function initYtDlp() {
    ytDlp = new YTDlpWrap(YTDLP_BINARY);
    ffmpegPath = await detectFFmpeg();

    try {
        await fs.access(YTDLP_BINARY);
        console.log('[yt-dlp] Binary found at:', YTDLP_BINARY);
    } catch {
        // 如果是 Linux 且預設路徑不存在，嘗試 tmp
        const fallback = path.join(os.tmpdir(), 'yt-dlp');
        try {
            await fs.access(fallback);
            ytDlp = new YTDlpWrap(fallback);
            console.log('[yt-dlp] Binary found at fallback:', fallback);
        } catch {
            console.log('[yt-dlp] Downloading binary...');
            await YTDlpWrap.downloadFromGithub(fallback);
            ytDlp = new YTDlpWrap(fallback);
            console.log('[yt-dlp] Binary downloaded to:', fallback);
        }
    }

    return ytDlp;
}

/**
 * 取得影片 metadata（標題、時長、縮圖）
 */
export async function getVideoInfo(url) {
    const info = await ytDlp.getVideoInfo(url);
    return {
        title: info.title,
        duration: info.duration,      // seconds
        thumbnail: info.thumbnail,
        uploader: info.uploader,
        extractor: info.extractor,   // 'youtube', etc.
    };
}

/**
 * 搜尋影片
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array>}
 */
export async function searchVideos(query, limit = 5) {
    const result = await ytDlp.execPromise([
        `ytsearch${limit}:${query}`,
        '--dump-json',
        '--no-playlist',
        '--flat-playlist'
    ]);

    // yt-dlp --dump-json for search returns multiple JSON objects (one per line)
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
        } catch (e) {
            console.error('[Search] Parse Error:', e.message);
            return null;
        }
    }).filter(Boolean);
}

/**
 * 擷取音訊並以 buffer 返回
 * @param {string} url
 * @param {function} onProgress - (percent) => void
 * @returns {Promise<{buffer: Buffer, filename: string, info: object}>}
 */
export async function extractAudio(url, onProgress) {
    // 先取得 metadata
    const info = await getVideoInfo(url);

    // 安全檔名
    const safeTitle = info.title.replace(/[^\w\u4e00-\u9fff\u3040-\u30ff\s-]/g, '').trim().substring(0, 80) || 'audio';
    const filename = `${safeTitle}.m4a`;

    // 輸出到 tmp 臨時檔案
    const tmpPath = path.join(os.tmpdir(), `stemsplit_${Date.now()}.m4a`);

    await new Promise((resolve, reject) => {
        const args = [
            url,
            '-f', 'ba/b', // 抓取最相容的音訊
            '--no-playlist',
            '--no-warnings',
            '--output', tmpPath,
        ];

        // 僅下載，不進行需要 ffprobe 的後處理

        const process = ytDlp.exec(args);

        process.on('ytDlpEvent', (eventType, eventData) => {
            if (eventType === 'download' && onProgress) {
                const match = eventData.match(/(\d+(?:\.\d+)?)%/);
                if (match) onProgress(parseFloat(match[1]));
            }
        });

        process.on('close', resolve);
        process.on('error', reject);
    });

    // 讀取 buffer
    const buffer = await fs.readFile(tmpPath);

    // 清理 tmp 檔案
    fs.unlink(tmpPath).catch(() => { });

    return { buffer, filename, info };
}
