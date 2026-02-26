
import fetch from 'node-fetch'; // assuming node-fetch is available or use native fetch in node 18+

async function test() {
    try {
        const response = await fetch('http://localhost:3001/api/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'Jay Chou 七里香' })
        });
        const data = await response.json();
        console.log('Search Results:', JSON.stringify(data, null, 2));

        if (data.results && data.results.length > 0) {
            const url = data.results[0].url;
            console.log('Testing Extract for:', url);
            const extractRes = await fetch('http://localhost:3001/api/extract', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            console.log('Extract Status:', extractRes.status);
            if (extractRes.status === 200) {
                console.log('Extract Success (received buffer)');
            } else {
                const errData = await extractRes.json();
                console.log('Extract Error:', errData);
            }
        }
    } catch (e) {
        console.error('Test failed:', e);
    }
}

test();
