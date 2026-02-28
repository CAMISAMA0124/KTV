// api/search.js - Vercel Serverless Function (uses YouTube Data API - no IP ban)
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'AIzaSyBBZzotQ2jYfdyqrZNhKcO-1AoGS5vI76k';

async function ytApiGet(url) {
    const res = await fetch(url);
    return res.json();
}

function isoToSecs(iso) {
    if (!iso) return 0;
    const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!m) return 0;
    return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Bypass-Tunnel-Reminder');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Support GET (query) and POST (body)
    const { query } = (req.method === 'GET' ? req.query : req.body) || {};
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        // 特別處理：如果輸入的是完整 YouTube 網址，直接擷取該影片
        let videoIdMatch = query.match(/(?:v=|\/embed\/|\/1\/|\/v\/|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);

        if (videoIdMatch) {
            const vid = videoIdMatch[1];
            const detailData = await ytApiGet(
                `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${vid}&key=${YOUTUBE_API_KEY}`
            );

            if (detailData.items && detailData.items.length > 0) {
                const item = detailData.items[0];
                return res.json({
                    results: [{
                        id: item.id,
                        url: `https://www.youtube.com/watch?v=${item.id}`,
                        title: item.snippet.title,
                        uploader: item.snippet.channelTitle,
                        thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
                        duration: isoToSecs(item.contentDetails?.duration) || 0
                    }]
                });
            }
        }

        // 正常搜尋模式
        const q = encodeURIComponent(query);
        const searchData = await ytApiGet(
            `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${q}&maxResults=5&type=video&relevanceLanguage=zh&regionCode=TW&key=${YOUTUBE_API_KEY}`
        );
        if (searchData.error) throw new Error(searchData.error.message);

        const items = searchData.items || [];
        if (!items.length) return res.json({ results: [] });

        const ids = items.map(i => i.id.videoId).join(',');
        const detailData = await ytApiGet(
            `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${ids}&key=${YOUTUBE_API_KEY}`
        );
        const durMap = {};
        (detailData.items || []).forEach(v => { durMap[v.id] = isoToSecs(v.contentDetails?.duration); });

        const results = items.map(item => ({
            id: item.id.videoId,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
            title: item.snippet.title,
            uploader: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails?.high?.url || item.snippet.thumbnails?.default?.url,
            duration: durMap[item.id.videoId] || 0,
        }));

        return res.json({ results });
    } catch (e) {
        console.error('[Vercel Search]', e.message);
        return res.status(500).json({ error: e.message });
    }
}
