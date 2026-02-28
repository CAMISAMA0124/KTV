// api/proxy.js
// Vercel Serverless Function - Meta Proxy v19 (Play-DL Native + Cobalt Strict)
// This proxy handles the "Metadata Fetch" phase to get the raw stream URL.

import play from 'play-dl';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    const videoIdMatch = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|\/shorts\/)([^"&?\/\s]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // ── 策略 1: Vercel 原生 JS 提取 (play-dl) ──
    try {
        console.log(`[v19 Proxy] Strategy 1: play-dl extracting... ${cleanUrl}`);
        const info = await play.video_info(cleanUrl);
        if (info && info.format) {
            // 尋找 M4A 音訊，或者如果沒有就拿任何純音軌
            let bestFormat = info.format.find(f => f.mimeType && f.mimeType.includes('audio/mp4'));
            if (!bestFormat) {
                bestFormat = info.format.find(f => f.hasAudio && !f.hasVideo);
            }
            if (bestFormat && bestFormat.url) {
                console.log(`[v19 Proxy] play-dl success!`);
                return res.status(200).json({ url: bestFormat.url });
            }
        }
    } catch (e) {
        console.warn(`[v19 Proxy] play-dl failed: ${e.message}`);
    }

    // ── 策略 2: 嚴格偽裝的 Cobalt (完全偽裝來源) ──
    try {
        console.log(`[v19 Proxy] Strategy 2: Cobalt strict mode...`);
        const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Origin': 'https://cobalt.tools',
                'Referer': 'https://cobalt.tools/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            body: JSON.stringify({ url: cleanUrl, aFormat: 'mp3', isAudioOnly: true }),
            signal: AbortSignal.timeout(8000)
        });
        if (cobaltRes.ok) {
            const data = await cobaltRes.json();
            if (data.url) {
                console.log(`[v19 Proxy] Cobalt success!`);
                return res.status(200).json({ url: data.url });
            }
        } else {
            console.warn(`[v19 Proxy] Cobalt returned status: ${cobaltRes.status}`);
        }
    } catch (e) {
        console.warn(`[v19 Proxy] Cobalt failed: ${e.message}`);
    }

    // ── 策略 3: Piped 公用備援 ──
    const MIRRORS = [
        `https://pipedapi.lunar.icu/streams/${videoId}`,
        `https://api-piped.mha.fi/streams/${videoId}`,
        `https://inv.vern.cc/api/v1/videos/${videoId}`
    ];
    for (const mirror of MIRRORS) {
        try {
            console.log(`[v19 Proxy] Strategy 3: ${mirror}`);
            const pRes = await fetch(mirror, { signal: AbortSignal.timeout(4000) });
            if (pRes.ok) {
                const data = await pRes.json();
                const stream = data.audioStreams?.[0]?.url || data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url;
                if (stream) return res.status(200).json({ url: stream });
            }
        } catch (e) { }
    }

    return res.status(502).json({ error: 'NO_WORKING_PROXIES', message: '所有後端伺服器與代理均被封鎖或失效' });
}
