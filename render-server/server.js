/**
 * server.js
 * Optimized for Render.com (includes auto-warmup)
 */
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import { initYtDlp, extractAudio, searchVideos, getVideoInfo } from './handler.js';

const app = express();
const PORT = process.env.PORT || 3000;
const EXTERNAL_URL = process.env.RENDER_EXTERNAL_URL;

app.use(cors()); // Simplified but fully permissive for cross-origin failover
app.use(express.json());

// Add pre-flight options support
app.options('*', cors());

let isReady = false;

// ── Health Check ───────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ ok: true, status: 'ok', ready: isReady, timestamp: new Date() });
});

// ── Search ─────────────────────────────────────────────────
app.post('/search', async (req, res) => {
    const { query } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Server warming up...' });
    try {
        const results = await searchVideos(query);
        res.json({ results });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Extract ────────────────────────────────────────────────
app.post('/extract', async (req, res) => {
    const { url } = req.body;
    if (!isReady) return res.status(503).json({ error: 'Server warming up...' });
    try {
        const { buffer, filename, info } = await extractAudio(url);
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('X-Video-Title', encodeURIComponent(info.title || filename));
        res.setHeader('X-Video-Duration', info.duration || 0);
        res.setHeader('Content-Length', buffer.length);
        res.send(buffer);
    } catch (e) {
        console.error('[Extract Error]:', e);
        res.status(500).json({
            error: '擷取失敗：' + (e.message || '未知錯誤'),
            tip: '多試幾次，或檢查 YouTube 網址是否格式正確'
        });
    }
});

// ── Render Warmup (Anti-Sleep) Logic ───────────────────────
function startWarmup() {
    if (!EXTERNAL_URL) {
        console.log('[Warmup] RENDER_EXTERNAL_URL not set. Self-ping disabled.');
        return;
    }

    setInterval(async () => {
        try {
            console.log(`[Warmup] Pinging ${EXTERNAL_URL}/health ...`);
            await axios.get(`${EXTERNAL_URL}/health`);
        } catch (e) {
            console.error('[Warmup] Ping failed:', e.message);
        }
    }, 10 * 60 * 1000);
}

// ── Start Server ───────────────────────────────────────────
app.listen(PORT, async () => {
    console.log(`[Render Server] Listening on port ${PORT}`);
    try {
        await initYtDlp();
        isReady = true;
        console.log('[Render Server] yt-dlp initialized.');
        startWarmup();
    } catch (e) {
        console.error('[Render Server] Init Error:', e.message);
    }
});

app.get('/', (req, res) => {
    res.json({ message: 'Audio API for Render is active', endpoints: ['/health', '/search', '/extract'] });
});
