/**
 * server/index.js
 * Express API Server — 提供 YouTube 音訊擷取 API
 * 監聽 PORT 3001，由 Vite dev server proxy /api/* 
 */

import express from 'express';
import cors from 'cors';
import { initYtDlp, extractAudio, getVideoInfo, searchVideos } from './youtube-handler.js';
import ytdl from '@distube/ytdl-core';
import play from 'play-dl';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Bypass-Tunnel-Reminder', 'Accept', 'X-Youtube-Cookies'],
    exposedHeaders: ['Content-Length', 'Content-Type']
}));
app.use(express.json());

// ── 提供靜態文件 (Vite 構建輸出) ──────────────────────────────
const distPath = join(__dirname, '../dist');
app.use(express.static(distPath));

// ── Init ────────────────────────────────────────────────────
let ytDlpReady = false;

async function startServer() {
    // 立即啟動監聽，避免 Zeabur 健康檢查失敗
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`[Server] Running on port ${PORT}`);
    });

    try {
        console.log('[Server] Initializing components...');
        await initYtDlp();
        ytDlpReady = true;
        console.log('[Server] yt-dlp ready');
    } catch (e) {
        console.error('[Server] yt-dlp init failed:', e.message);
        console.error('[Server] YouTube 功能將不可用');
    }
}

// ── Health check ────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ ok: true, ytDlpReady });
});

// ── Search videos (GET to avoid Preflight) ───────────────────
app.get(['/api/search', '/api/search.json'], async (req, res) => {
    const { query } = req.query;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: '請提供搜尋關鍵字' });
    }

    if (!ytDlpReady) {
        return res.status(503).json({ error: 'yt-dlp 尚未就緒' });
    }

    try {
        console.log(`[Search] Query: ${query}`);
        const results = await searchVideos(query);
        res.json({ ok: true, results });
    } catch (e) {
        console.error('[Search] Error:', e.message);
        res.status(500).json({ error: `搜尋失敗: ${e.message}` });
    }
});


// ── Video info (metadata only, no download) ─────────────────
app.all(['/api/info', '/api/info.json'], async (req, res) => {
    const { url } = (req.method === 'GET' ? req.query : req.body) || {};

    if (!url || typeof url !== 'string') {
        return res.status(400).json({ error: '請提供有效的 URL' });
    }

    if (!ytDlpReady) {
        return res.status(503).json({ error: 'yt-dlp 尚未就緒，請稍候' });
    }

    // 只支援 YouTube
    if (!isYouTubeURL(url)) {
        return res.status(400).json({
            error: 'DRM_PROTECTED',
            message: '目前只支援 YouTube 連結。Spotify / KKbox 因 DRM 版權保護無法擷取。',
        });
    }

    try {
        const info = await getVideoInfo(url);
        res.json({ ok: true, info });
    } catch (e) {
        res.status(500).json({ error: `無法取得影片資訊: ${e.message}` });
    }
});

app.all(['/api/proxy', '/api/proxy.json'], async (req, res) => {
    const { url, aFormat = 'mp3', isAudioOnly = true } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    console.log(`[Local Proxy v19.3] Request: ${url}`);
    const videoIdMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([^"&?\/\s]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    // ── 策略 1: 本地 play-dl 提取 (最強大，使用用戶家用 IP) ──
    try {
        console.log(`[Local Proxy] Strategy 1: play-dl extraction...`);
        const info = await play.video_info(url);
        // 抓取音檔格式
        const format = info.format.find(f => f.mimeType && f.mimeType.includes('audio/mp4')) || info.format.find(f => f.hasAudio && !f.hasVideo);
        if (format && format.url) {
            console.log(`[Local Proxy] play-dl success!`);
            return res.json({ url: format.url });
        }
    } catch (e) {
        console.warn(`[Local Proxy] play-dl failed: ${e.message}`);
    }

    // ── 策略 2: 本地 ytdl-core 備援 ──
    try {
        console.log(`[Local Proxy] Strategy 2: ytdl-core extraction...`);
        const info = await ytdl.getInfo(url);
        const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
        if (format && format.url) {
            console.log(`[Local Proxy] ytdl success!`);
            return res.json({ url: format.url });
        }
    } catch (e) {
        console.warn(`[Local Proxy] ytdl failed: ${e.message}`);
    }

    // ── 策略 2: 備援 Piped/Cobalt ──
    const targets = [
        { type: 'piped', url: videoId ? `https://pipedapi.lunar.icu/streams/${videoId}` : null },
        { type: 'cobalt', url: 'https://api.cobalt.tools/api/json' }
    ].filter(t => t.url);

    for (const t of targets) {
        try {
            console.log(`[Local Proxy] Trying fallback ${t.type}: ${t.url}`);
            const options = t.type === 'cobalt' ? {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Origin': 'https://cobalt.tools',
                    'Referer': 'https://cobalt.tools/'
                },
                body: JSON.stringify({ url, aFormat, isAudioOnly })
            } : { method: 'GET' };

            const response = await fetch(t.url, { ...options, signal: AbortSignal.timeout(8000) });
            if (response.ok) {
                const data = await response.json();
                if (t.type === 'piped') {
                    const stream = data.audioStreams?.[0]?.url || data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url;
                    if (stream) return res.json({ url: stream });
                } else if (data.url) {
                    return res.json({ url: data.url });
                }
            }
        } catch (e) {
            console.warn(`[Local Proxy] ${t.type} failed: ${e.message}`);
        }
    }
    res.status(502).json({ error: 'LOCAL_PROXY_ALL_FAILED' });
});




// ── Extract audio (Redirected to Client) ──────────────────────
app.post('/api/extract', async (req, res) => {
    return res.status(403).json({
        error: 'BACKEND_DOWNLOAD_DISABLED',
        message: '為確保服務穩定，下載功能已移至用戶端。請更新前端使用 Cobalt 模式。'
    });
});




// ── Helpers ─────────────────────────────────────────────────
function isYouTubeURL(url) {
    try {
        const u = new URL(url);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch {
        return false;
    }
}

// ── Fallback 路由 (支援 SPA 重新整理) ────────────────────────
app.use((req, res, next) => {
    // 如果不是 API 請求，則返回 index.html
    if (!req.path.startsWith('/api')) {
        res.sendFile(join(__dirname, '../dist/index.html'));
    } else {
        next();
    }
});

// ── Start ────────────────────────────────────────────────────
startServer().catch(console.error);
