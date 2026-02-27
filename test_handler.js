import { initYtDlp, searchVideos } from './server/youtube-handler.js';

async function test() {
    console.log('Initializing yt-dlp...');
    await initYtDlp();
    console.log('Searching for 七里香...');
    const results = await searchVideos('七里香');
    console.log('Results:', JSON.stringify(results, null, 2));
}

test().catch(console.error);
