// api/proxy.js
// Vercel Serverless Function - Meta Proxy v14 (Zero-Friction & High-SLA)
// Robust server-side fetching via Multiple Piped mirrors + Cobalt to bypass Vercel IP blocks

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { url } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // ── 策略 1: 多路 Piped API 鏡像源 (目前最穩定的 GET 源) ──
    const PIPED_MIRRORS = [
        'https://pipedapi.pablo.casa',
        'https://piped-api.lunar.icu',
        'https://api-piped.mha.fi',
        'https://piped-api.hostux.net',
        'https://pipedapi.darkness.services'
    ];

    for (const base of PIPED_MIRRORS) {
        try {
            console.log(`[v14 Proxy] Trying Piped: ${base}`);
            const pipedRes = await fetch(`${base}/streams/${videoId}`, { signal: AbortSignal.timeout(6000) });
            if (pipedRes.ok) {
                const data = await pipedRes.json();
                if (data.audioStreams?.[0]?.url) {
                    return res.status(200).json({ url: data.audioStreams[0].url });
                }
            }
        } catch (e) { console.warn(`[v14 Proxy] Piped ${base} failed: ${e.message}`); }
    }

    // ── 策略 2: Invidious API (備援 GET 源) ──
    try {
        const invRes = await fetch(`https://inv.vern.cc/api/v1/videos/${videoId}`, { signal: AbortSignal.timeout(6000) });
        if (invRes.ok) {
            const data = await invRes.json();
            const stream = data.adaptiveFormats?.find(f => f.type.includes('audio/mp4'))?.url;
            if (stream) return res.status(200).json({ url: stream });
        }
    } catch (e) { }

    // ── 策略 3: Cobalt API (POST 源) ──
    const COBALT_INSTANCES = ['https://co.wuk.sh/api/json', 'https://api.cobalt.tools/api/json'];
    for (const api of COBALT_INSTANCES) {
        try {
            const response = await fetch(api, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
                body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true }),
                signal: AbortSignal.timeout(8000)
            });
            if (response.ok) {
                const data = await response.json();
                if (data.url) return res.status(200).json(data);
            }
        } catch (e) { }
    }

    return res.status(502).json({ error: 'ALL_PROXIES_FAILED' });
}

