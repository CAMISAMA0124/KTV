// api/extract.js - Vercel Serverless Function for audio extraction
// Vercel uses rotating IPs → less likely to be blocked by YouTube
import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const execFileAsync = promisify(execFile);

// Find yt-dlp binary
function getYtDlpPath() {
    const candidates = [
        '/usr/local/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        'yt-dlp',
    ];
    for (const p of candidates) {
        if (existsSync(p)) return p;
    }
    return 'yt-dlp'; // fallback
}

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    const tmpPath = join(tmpdir(), `vercel_${Date.now()}.m4a`);
    const ytDlp = getYtDlpPath();

    try {
        // Get info first
        const { stdout: infoOut } = await execFileAsync(ytDlp, [
            url, '--dump-json',
            '--extractor-args', 'youtube:player-client=android_music,ios',
            '--no-cache-dir',
        ], { timeout: 30000 });
        const info = JSON.parse(infoOut.trim());

        // Download audio
        await execFileAsync(ytDlp, [
            url,
            '-f', 'ba/b',
            '--no-playlist',
            '--no-part',
            '--no-cache-dir',
            '--force-overwrites',
            '--extractor-args', 'youtube:player-client=android_music,ios',
            '--output', tmpPath,
        ], { timeout: 120000 });

        const buffer = readFileSync(tmpPath);
        try { unlinkSync(tmpPath); } catch { }

        const safeTitle = (info.title || 'audio').replace(/[^\w\s-]/g, '').trim().substring(0, 50);
        res.setHeader('Content-Type', 'audio/mp4');
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeTitle)}.m4a"`);
        res.setHeader('X-Video-Title', encodeURIComponent(info.title || safeTitle));
        res.setHeader('X-Video-Duration', info.duration || 0);
        res.setHeader('Content-Length', buffer.length);
        return res.send(buffer);

    } catch (e) {
        try { unlinkSync(tmpPath); } catch { }
        console.error('[Vercel Extract]', e.message);
        return res.status(500).json({ error: e.message });
    }
}
