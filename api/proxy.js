import yts from 'yt-search';

// Proxy Cobalt JSON request to bypass CORS in browser
// Since it's server-to-server, it won't hit CORS.
// Since it's just a JSON request, it won't hit Vercel timeouts for heavy downloads.
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { url, aFormat = 'mp3', isAudioOnly = true } = req.body;
    if (!url) return res.status(400).json({ error: 'Missing URL' });

    const COBALT_INSTANCES = [
        'https://api.cobalt.tools/api/json',
        'https://co.wuk.sh/api/json',
        'https://cobalt.hypertube.xyz/api/json'
    ];

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    let lastError = null;
    for (const api of COBALT_INSTANCES) {
        try {
            console.log(`[Vercel Proxy] Trying: ${api}`);
            const response = await fetch(api, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    url,
                    aFormat,
                    isAudioOnly,
                    vQuality: '720'
                }),
                signal: AbortSignal.timeout(10000)
            });

            if (response.ok) {
                const data = await response.json();
                return res.status(200).json(data);
            }
            const errBody = await response.json().catch(() => ({}));
            console.warn(`[Vercel Proxy] ${api} failed: ${errBody.text || response.status}`);
        } catch (e) {
            lastError = e;
            console.warn(`[Vercel Proxy] ${api} error: ${e.message}`);
        }
    }

    return res.status(502).json({
        error: 'COBALT_PROXY_FAILED',
        message: lastError?.message || '所有 Cobalt 節點皆忙碌中'
    });
}
