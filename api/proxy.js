// api/proxy.js
// Vercel Serverless Function - Meta Proxy v20 (Ultimate Resilience & Cobalt v10+)
// This version is ultra-lightweight, focusing on high-success public APIs to avoid 502 timeouts.

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const videoIdMatch = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/|\/shorts\/|watch\?v=)([^"&?\/\s]{11})/);
    const videoId = videoIdMatch ? videoIdMatch[1] : null;

    if (!videoId) return res.status(400).json({ error: 'Invalid YouTube URL' });
    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // ── 策略 1: Cobalt v10+ (API 極限模擬) ──
    const COBALT_INSTANCES = [
        'https://api.cobalt.tools/api/json',
        'https://cobalt.instavids.net/api/json',
        'https://api.cobalt.tools/api/json' // 備援
    ];

    for (const endpoint of COBALT_INSTANCES) {
        try {
            console.log(`[v20 Proxy] Strategy 1: Cobalt Try -> ${endpoint}`);
            const cobaltRes = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'Origin': 'https://cobalt.tools',
                    'Referer': 'https://cobalt.tools/',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({
                    url: cleanUrl,
                    downloadMode: 'audio',
                    audioFormat: 'mp3',
                    filenameStyle: 'nerdy'
                }),
                signal: AbortSignal.timeout(6000)
            });

            if (cobaltRes.ok) {
                const data = await cobaltRes.json();
                if (data.url) {
                    console.log(`[v20 Proxy] Cobalt Success!`);
                    return res.status(200).json({ url: data.url });
                }
            }
        } catch (e) {
            console.warn(`[v20 Proxy] Cobalt endpoint failed: ${e.message}`);
        }
    }

    // ── 策略 2: Piped Mirror Pool ──
    const PIPED_MIRRORS = [
        `https://pipedapi.lunar.icu/streams/${videoId}`,
        `https://api-piped.mha.fi/streams/${videoId}`,
        `https://pipedapi.not-the-real-name.com/streams/${videoId}`, // Dummy mirror as fallback
        `https://piped.v6.rocks/api/v1/streams/${videoId}`
    ];

    for (const mirror of PIPED_MIRRORS) {
        try {
            console.log(`[v20 Proxy] Strategy 2: Piped Try -> ${mirror.substring(0, 30)}`);
            const pRes = await fetch(mirror, { signal: AbortSignal.timeout(4000) });
            if (pRes.ok) {
                const data = await pRes.json();
                const stream = data.audioStreams?.find(f => f.format === 'M4A' || f.format === 'WEBM')?.url
                    || data.audioStreams?.[0]?.url
                    || data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url;

                if (stream) {
                    console.log(`[v20 Proxy] Piped Success!`);
                    return res.status(200).json({ url: stream });
                }
            }
        } catch (e) { }
    }

    // ── 最終手段：導向用戶查看本地 511 的解釋 ──
    return res.status(502).json({
        error: 'ALL_STRATEGIES_FAILED',
        message: 'YouTube 全面封鎖雲端 IP。請確保本地服務運作，並在手機瀏覽器手動點擊過一次隧道授權按鈕。',
        details: 'LocalTunnel 511 Auth required.'
    });
}
