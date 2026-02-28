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

// ── Search videos ───────────────────────────────────────────
app.post('/api/search', async (req, res) => {
    const { query } = req.body;

    if (!query || typeof query !== 'string') {
        return res.status(400).json({ error: '請提供搜尋關鍵字' });
    }

    if (!ytDlpReady) {
        return res.status(503).json({ error: 'yt-dlp 尚未就緒' });
    }

    try {
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

// ── Cobalt Proxy (Solve Browser CORS) ────────────────────────
// This allows the browser to call Cobalt via our backend, bypassing CORS.
// Since it's a small JSON request, it won't hit Vercel timeouts or payload limits.
app.post('/api/proxy/cobalt', async (req, res) => {
    const { url, aFormat = 'mp3', isAudioOnly = true } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const COBALT_INSTANCES = [
        'https://api.cobalt.tools/api/json',
        'https://co.wuk.sh/api/json',
        'https://cobalt.hypertube.xyz/api/json'
    ];

    let lastError = null;
    for (const api of COBALT_INSTANCES) {
        try {
            console.log(`[Proxy] Trying Cobalt instance: ${api}`);
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ url, aFormat, isAudioOnly, vQuality: '720' }),
                signal: AbortSignal.timeout(8000)
            });

            if (response.ok) {
                const data = await response.json();
                return res.json(data);
            }
            const err = await response.json().catch(() => ({}));
            console.warn(`[Proxy] ${api} failed: ${err.text || response.status}`);
        } catch (e) {
            lastError = e;
            console.warn(`[Proxy] ${api} error: ${e.message}`);
        }
    }

    res.status(502).json({ error: 'COBALT_PROXY_FAILED', message: lastError?.message || '所有 Cobalt 節點皆忙碌中' });
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
