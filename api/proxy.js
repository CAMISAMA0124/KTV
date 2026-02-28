// api/proxy.js
// Vercel Serverless Function - Cobalt API Proxy
// This handles the server-side metadata fetch to bypass browser CORS.

export default async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { url, aFormat = 'mp3', isAudioOnly = true } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const COBALT_INSTANCES = [
        'https://co.wuk.sh/api/json',
        'https://api.cobalt.tools/api/json',
        'https://cobalt.hypertube.xyz/api/json'
    ];

    res.setHeader('Access-Control-Allow-Origin', '*');

    for (const api of COBALT_INSTANCES) {
        try {
            console.log(`[Vercel Proxy] Calling instance: ${api}`);
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                },
                body: JSON.stringify({ url, aFormat, isAudioOnly, vQuality: '720' }),
                signal: AbortSignal.timeout(8000)
            });

            if (response.ok) {
                const data = await response.json();
                return res.status(200).json(data);
            }
            console.warn(`[Vercel Proxy] ${api} status: ${response.status}`);
        } catch (e) {
            console.warn(`[Vercel Proxy] ${api} error: ${e.message}`);
        }
    }

    return res.status(502).json({
        error: 'COBALT_PROXY_FAILED',
        message: '目前所有自動化引擎皆忙碌中，請稍後重試。'
    });
}
