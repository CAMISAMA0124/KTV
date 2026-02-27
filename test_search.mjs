async function testSearch() {
    try {
        const query = '七里香';
        console.log(`Testing search for: ${query}`);
        const res = await fetch('http://localhost:3001/api/search', {
            method: 'POST',
            body: JSON.stringify({ query }),
            headers: { 'Content-Type': 'application/json' }
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('Search failed:', res.status, err);
            return;
        }

        const data = await res.json();
        console.log(`Found ${data.results?.length} results`);
        if (data.results && data.results.length > 0) {
            console.log('First result:', data.results[0].title);
        }
    } catch (e) {
        console.error('Network error:', e.message);
    }
}

testSearch();
