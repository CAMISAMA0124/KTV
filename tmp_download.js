import play from 'play-dl';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import axios from 'axios';

async function download() {
    const url = 'https://www.youtube.com/watch?v=Bbp9ZaJD_eA';
    const outputPath = 'C:/Users/CAMISAMA/Downloads/QiLiXiang.mp3';

    console.log('正在解析影片資訊 (V33 背景)...');
    const info = await play.video_info(url);

    // 找出音訊軌 (優先選擇 audio/mp4)
    const audioFormat = info.format.find(f => f.mimeType && f.mimeType.includes('audio/mp4'))
        || info.format.find(f => f.mimeType && f.mimeType.includes('audio/webm'));

    if (!audioFormat || !audioFormat.url) {
        console.log('可用格式:', info.format.map(f => f.mimeType));
        throw new Error('找不到音軌連結');
    }

    console.log('已尋獲音軌，正在下載至:', outputPath);

    const response = await axios({
        method: 'get',
        url: audioFormat.url,
        responseType: 'stream'
    });

    const fileStream = fs.createWriteStream(outputPath);
    await pipeline(response.data, fileStream);

    console.log('✅ 背景下載成功！');
    console.log('檔案位置:', outputPath);
}

download().catch(e => {
    console.error('❌ 下載失敗:', e.message);
});
