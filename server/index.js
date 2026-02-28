/**
 * server/index.js
 * Express API Server — 提供 YouTube 音訊擷取 API
 * 監聽 PORT 3001，由 Vite dev server proxy /api/* 
 */

import express from 'express';
import cors from 'cors';
import { initYtDlp, extractAudio, getVideoInfo, searchVideos } from './youtube-handler.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ──────────────────────────────────────────────
app.use(cors({
    origin: ['http://localhost:5173', 'http://localhost:4173', 'https://aiktv.vercel.app'],
    credentials: true,
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
app.get('/api/search', async (req, res) => {
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
app.post('/api/info', async (req, res) => {
    const { url } = req.body;

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

// ── Super-Permissive CORS (v16) ─────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Bypass-Tunnel-Reminder', 'Accept', 'X-Youtube-Cookies'],
    exposedHeaders: ['Content-Length', 'Content-Type']
}));



app.all('/api/proxy', async (req, res) => {
    const { url, aFormat = 'mp3', isAudioOnly = true } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    console.log(`[Local Proxy] Mode: ${req.method} | URL: ${url}`);

    // 多組鏡像源嘗試
    const targets = [
        { type: 'piped', url: `https://pipedapi.kavin.rocks/streams/${url.match(/(?:v=|\/embed\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1]}` },
        { type: 'cobalt', url: 'https://co.wuk.sh/api/json' },
        { type: 'cobalt', url: 'https://api.cobalt.tools/api/json' }
    ];

    for (const t of targets) {
        try {
            console.log(`[Local Proxy] Trying ${t.type}: ${t.url}`);
            const options = t.type === 'cobalt' ? {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ url, aFormat, isAudioOnly })
            } : { method: 'GET' };

            const response = await fetch(t.url, { ...options, signal: AbortSignal.timeout(10000) });
            if (response.ok) {
                const data = await response.json();
                // 統一回傳格式
                if (t.type === 'piped') {
                    return res.json({ url: data.audioStreams?.[0]?.url });
                }
                return res.json(data);
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
