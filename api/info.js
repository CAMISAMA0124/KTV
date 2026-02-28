// api/info.js - Vercel Serverless Function to get video info
import yts from 'yt-search';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Support GET (query) and POST (body)
    const { url } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!url) return res.status(400).json({ error: 'Missing url' });

    try {
        const video = await yts(url);
        if (!video.videos || video.videos.length === 0) {
            if (video.title) {
                return res.json({
                    info: {
                        title: video.title,
                        duration: video.seconds || 0,
                        thumbnail: video.thumbnail || video.image,
                        uploader: video.author?.name || 'YouTube',
                    }
                });
            }
            return res.status(404).json({ error: 'Video not found' });
        }
        const v = video.videos[0];

        return res.json({
            info: {
                title: v.title,
                duration: v.seconds,
                thumbnail: v.thumbnail || v.image,
                uploader: v.author?.name || 'YouTube',
            }
        });
    } catch (e) {
        console.error('[Vercel Info]', e.message);
        return res.status(500).json({ error: e.message });
    }
}
