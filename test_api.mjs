// Node 18+ built-in fetch

async function test() {
    try {
        console.log('Testing /api/extract...');
        const res = await fetch('http://localhost:3001/api/extract', {
            method: 'POST',
            body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=Bbp9ZaJD_eA' }),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            const err = await res.json();
            console.error('Extraction failed:', err);
            return;
        }

        console.log('Extraction success!');
        console.log('Content-Type:', res.headers.get('Content-Type'));
        console.log('Content-Length:', res.headers.get('Content-Length'));
        console.log('Video-Title:', decodeURIComponent(res.headers.get('X-Video-Title')));

        const buffer = await res.arrayBuffer();
        console.log('Received buffer size:', buffer.byteLength);
    } catch (e) {
        console.error(e);
    }
}

test();
