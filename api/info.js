// api/info.js - Vercel Serverless Function to get video info
import { execFile } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';

const execFileAsync = promisify(execFile);

function getYtDlpPath() {
    const candidates = ['/usr/local/bin/yt-dlp', '/usr/bin/yt-dlp', 'yt-dlp'];
    for (const p of candidates) { if (existsSync(p)) return p; }
    return 'yt-dlp';
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        const ytDlp = getYtDlpPath();
        const { stdout } = await execFileAsync(ytDlp, [
            url, '--dump-json',
            '--no-cache-dir',
            '--extractor-args', 'youtube:player-client=tv,android'
        ], { timeout: 15000 });

        const info = JSON.parse(stdout.trim());
        return res.json({ info });
    } catch (e) {
        console.error('[Vercel Info]', e.message);
        return res.status(500).json({ error: e.message });
    }
}
