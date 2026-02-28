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
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Bypass-Tunnel-Reminder, X-Youtube-Cookies');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
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
    const { url } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    console.log(`[Proxy] Stream request: ${url}`);
    const videoIdMatch = url.match(/(?:v=|\/embed\/|youtu\.be\/|\/shorts\/)([^"&?\/\s]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    // 尋找音源連結 (內部使用，不回傳給前端)
    let audioUrl = null;

    // 策略 1: play-dl
    try {
        const info = await play.video_info(url);
        const format = info.format.find(f => f.mimeType && f.mimeType.includes('audio/mp4'))
            || info.format.find(f => f.mimeType && f.mimeType.includes('audio/webm'))
            || info.format.find(f => f.hasAudio && !f.hasVideo);
        if (format?.url) {
            audioUrl = format.url;
            console.log(`[Proxy] play-dl found audio URL`);
        }
    } catch (e) {
        console.warn(`[Proxy] play-dl failed: ${e.message}`);
    }

    // 策略 2: ytdl-core
    if (!audioUrl) {
        try {
            const info = await ytdl.getInfo(url);
            const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio', filter: 'audioonly' });
            if (format?.url) {
                audioUrl = format.url;
                console.log(`[Proxy] ytdl found audio URL`);
            }
        } catch (e) {
            console.warn(`[Proxy] ytdl failed: ${e.message}`);
        }
    }

    if (!audioUrl) {
        return res.status(502).json({ error: 'LOCAL_PROXY_ALL_FAILED', message: '無法取得音源連結' });
    }

    // ── 核心修正：直接在後端串流音訊給前端 ──
    // 這樣前端永遠不會碰到 googlevideo.com 的 CORS 限制
    try {
        console.log(`[Proxy] Streaming audio to client...`);
        const audioRes = await fetch(audioUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
                'Referer': 'https://www.youtube.com/',
                'Origin': 'https://www.youtube.com'
            },
            signal: AbortSignal.timeout(30000)
        });

        if (!audioRes.ok) throw new Error(`upstream ${audioRes.status}`);

        res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/webm');
        res.setHeader('Content-Disposition', `attachment; filename="${videoId || 'audio'}.mp3"`);
        const cl = audioRes.headers.get('content-length');
        if (cl) res.setHeader('Content-Length', cl);

        // Node.js stream pipe
        const { Readable } = await import('stream');
        const readable = Readable.fromWeb(audioRes.body);
        readable.pipe(res);
        readable.on('error', (e) => {
            console.error('[Proxy] Stream error:', e.message);
            res.destroy();
        });
    } catch (e) {
        console.error('[Proxy] Streaming failed:', e.message);
        if (!res.headersSent) res.status(502).json({ error: 'STREAM_FAILED', message: e.message });
    }
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
