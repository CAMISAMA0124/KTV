// api/proxy.js
// Vercel Serverless Function - Meta Proxy v15 (Ultra-Resilient Pool)
// This proxy handles the "Metadata Fetch" phase to get the raw stream URL.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });

    // ── 策略 1: Invidious Instances (通常比 Piped 穩定且直接) ──
    const INVIDIOUS_INSTANCES = [
        'https://inv.vern.cc',
        'https://invidious.snopyta.org',
        'https://yewtu.be',
        'https://iv.melmac.space',
        'https://invidious.sethforprivacy.com'
    ];

    for (const inv of INVIDIOUS_INSTANCES) {
        try {
            console.log(`[v15 Proxy] Trying Invidious: ${inv}`);
            const response = await fetch(`${inv}/api/v1/videos/${videoId}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (response.ok) {
                const data = await response.json();
                const stream = data.adaptiveFormats?.find(f => f.type.includes('audio/mp4')) || data.adaptiveFormats?.find(f => f.type.startsWith('audio/'));
                if (stream && stream.url) {
                    return res.status(200).json({ url: stream.url, title: data.title });
                }
            }
        } catch (e) {
            console.warn(`[v15 Proxy] Invidious ${inv} failed: ${e.message}`);
        }
    }

    // ── 策略 2: Piped Mirrors (新鮮列表) ──
    const PIPED_MIRRORS = [
        'https://piped-api.lunar.icu',
        'https://api-piped.mha.fi',
        'https://pipedapi.pablo.casa',
        'https://piped-api.hostux.net'
    ];

    for (const pipe of PIPED_MIRRORS) {
        try {
            console.log(`[v15 Proxy] Trying Piped: ${pipe}`);
            const response = await fetch(`${pipe}/streams/${videoId}`, {
                signal: AbortSignal.timeout(5000)
            });
            if (response.ok) {
                const data = await response.json();
                if (data.audioStreams?.[0]?.url) {
                    return res.status(200).json({ url: data.audioStreams[0].url });
                }
            }
        } catch (e) {
            console.warn(`[v15 Proxy] Piped ${pipe} failed: ${e.message}`);
        }
    }

    // ── 策略 3: Cobalt Failover ──
    try {
        const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true }),
            signal: AbortSignal.timeout(8000)
        });
        if (cobaltRes.ok) {
            const data = await cobaltRes.json();
            if (data.url) return res.status(200).json(data);
        }
    } catch (e) { }

    return res.status(502).json({ error: 'FAILED_TO_BYPASS_YT_PROTECTION', message: '目前所有鏡像源皆被 YouTube 封鎖。' });
}
