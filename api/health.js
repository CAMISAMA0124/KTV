export default function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(200).json({ ok: true, status: 'ok', provider: 'vercel' });
}
