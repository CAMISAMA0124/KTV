/**
 * Local Test Script for YouTube Extraction
 */
import { initYtDlp, extractAudio } from './render-server/handler.js';

async function test() {
    console.log('--- Checking yt-dlp ---');
    await initYtDlp();

    const testUrl = 'https://www.youtube.com/watch?v=Bbp9ZaJD_eA';
    console.log(`--- Testing Extraction: ${testUrl} ---`);

    try {
        const result = await extractAudio(testUrl, (progress) => {
            process.stdout.write(`\rProgress: ${progress.toFixed(1)}%`);
        });
        console.log('\n\n✅ Success!');
        console.log('Title:', result.info.title);
        console.log('Duration:', result.info.duration, 'seconds');
        console.log('Buffer safe-check:', result.buffer.length, 'bytes');
    } catch (e) {
        console.error('\n\n❌ Failed:', e.message);
    }
}

test();
