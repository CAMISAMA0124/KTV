// api/proxy.js
// Vercel Serverless Function - Meta Proxy v16 (Zero-Friction & Mirror Pool)
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

    // 鏡像池：加入更多當前在線的實例
    const MIRRORS = [
        `https://pipedapi.lunar.icu/streams/${videoId}`,
        `https://api-piped.mha.fi/streams/${videoId}`,
        `https://inv.vern.cc/api/v1/videos/${videoId}`,
        `https://yewtu.be/api/v1/videos/${videoId}`,
        `https://iv.melmac.space/api/v1/videos/${videoId}`
    ];

    for (const api of MIRRORS) {
        try {
            console.log(`[v16 Proxy] Trying: ${api}`);
            const response = await fetch(api, { signal: AbortSignal.timeout(6000) });
            if (response.ok) {
                const data = await response.json();
                // 適配 Piped 與 Invidious 格式
                const stream = data.audioStreams?.[0]?.url
                    || data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url;

                if (stream) return res.status(200).json({ url: stream });
            }
        } catch (e) { console.warn(`[v16 Proxy] ${api} failed: ${e.message}`); }
    }

    // 最後手段：Cobalt (POST)
    try {
        const cobaltRes = await fetch('https://api.cobalt.tools/api/json', {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
            body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true }),
            signal: AbortSignal.timeout(8000)
        });
        if (cobaltRes.ok) {
            const data = await cobaltRes.json();
            if (data.url) return res.status(200).json({ url: data.url });
        }
    } catch (e) { }

    return res.status(502).json({ error: 'NO_WORKING_PROXIES' });
}
