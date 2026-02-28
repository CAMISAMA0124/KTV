// api/proxy.js
// Vercel Serverless Function - Meta Proxy v10
// Robust server-side fetching via Piped + Cobalt to bypass Vercel IP blocks

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });
    const videoId = url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1];

    // ── 策略 1: Piped API (Server-to-Server, IP 通常較乾淨) ──
    try {
        console.log(`[Backup Proxy] Calling Piped for ID: ${videoId}`);
        const pipedRes = await fetch(`https://pipedapi.kavin.rocks/streams/${videoId}`, {
            signal: AbortSignal.timeout(6000)
        });
        if (pipedRes.ok) {
            const data = await pipedRes.json();
            if (data.audioStreams?.[0]?.url) {
                return res.status(200).json({ url: data.audioStreams[0].url });
            }
        }
    } catch (e) {
        console.warn(`[Backup Proxy] Piped failed: ${e.message}`);
    }

    // ── 策略 2: Cobalt API (高質感 UA 模擬) ──
    const COBALT_INSTANCES = [
        'https://co.wuk.sh/api/json',
        'https://api.cobalt.tools/api/json',
        'https://cobalt.hypertube.xyz/api/json'
    ];

    for (const api of COBALT_INSTANCES) {
        try {
            console.log(`[Backup Proxy] Calling Cobalt instance: ${api}`);
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0 Safari/537.36'
                },
                body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true }),
                signal: AbortSignal.timeout(8000)
            });

            if (response.ok) {
                const data = await response.json();
                if (data.url) return res.status(200).json(data);
            }
        } catch (e) { console.warn(`[Backup Proxy] ${api} failed: ${e.message}`); }
    }

    return res.status(502).json({ error: 'ALL_PROXIES_FAILED', message: '目前所有擷取引擎皆忙碌中，請稍後再試。' });
}
