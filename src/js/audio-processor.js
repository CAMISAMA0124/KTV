/**
 * audio-processor.js
 * Web Audio API 音訊解碼、重採樣、分塊
 * 將 MP3/WAV 轉換為 AI 可處理的 Float32Array 矩陣
 */

/**
 * 支援快速模板分離 (L-R) 與升降 Key
 */

export const PITCH_RANGE = 5; // +- 5 semitones

// Demucs 要求的採樣率
const TARGET_SAMPLE_RATE = 44100;

export async function decodeAudioFile(file, onStatus) {
    onStatus?.('🎵 解碼音訊檔案...');

    let arrayBuffer = await file.arrayBuffer();
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    let decoded;
    try {
        decoded = await audioCtx.decodeAudioData(arrayBuffer);
    } finally {
        // 關鍵優化：解碼後立即手動釋放 ArrayBuffer
        arrayBuffer = null;
        await audioCtx.close();
    }

    onStatus?.(`✅ 音訊解碼完成: ${decoded.numberOfChannels}ch, ${decoded.sampleRate}Hz, ${(decoded.duration).toFixed(1)}s`);
    return decoded;
}

export async function resampleBuffer(buffer, targetSampleRate = TARGET_SAMPLE_RATE, onStatus) {
    if (buffer.sampleRate === targetSampleRate) {
        return buffer;
    }

    onStatus?.(`🔄 重採樣: ${buffer.sampleRate}Hz → ${targetSampleRate}Hz`);

    const duration = buffer.duration;
    const outputLength = Math.ceil(duration * targetSampleRate);
    const channels = Math.min(buffer.numberOfChannels, 2);

    const offlineCtx = new OfflineAudioContext(channels, outputLength, targetSampleRate);

    // 直接建立 source 並連結，避免額外建立 sourceBuffer 並拷貝 (若能直接 assign)
    // 註：有些舊版瀏覽器不支援直接 assign buffer，但現代環境 OK
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const rendered = await offlineCtx.startRendering();

    // 釋放舊 Buffer 的內容 (提示 GC)
    // buffer = null; 

    return rendered;
}

/**
 * 將 AudioBuffer 轉換為 stereo Float32Array [2, samples]
 * Demucs 期望 stereo 輸入
 * @param {AudioBuffer} buffer
 * @returns {{ left: Float32Array, right: Float32Array, samples: number }}
 */
export function bufferToStereoArrays(buffer) {
    const channels = buffer.numberOfChannels;
    const samples = buffer.length;

    const left = new Float32Array(samples);
    const right = new Float32Array(samples);

    // Copy left channel
    buffer.copyFromChannel(left, 0);

    // If mono, duplicate to right; otherwise copy right channel
    if (channels >= 2) {
        buffer.copyFromChannel(right, 1);
    } else {
        right.set(left);
    }

    return { left, right, samples };
}

/**
 * 將音訊切分為重疊 chunks，供逐塊推論
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {object} config - { segment (seconds), overlap (0-1), sampleRate }
 * @returns {Array<{leftChunk: Float32Array, rightChunk: Float32Array, startSample: number, endSample: number}>}
 */
export function sliceIntoChunks(left, right, config) {
    const { segment, overlap, sampleRate } = config;
    const chunkSamples = Math.round(segment * sampleRate);  // must be exactly 343980 for htdemucs_embedded
    const overlapSamples = Math.floor(chunkSamples * overlap);
    const stepSamples = chunkSamples - overlapSamples;
    const totalSamples = left.length;

    const chunks = [];
    let start = 0;

    while (start < totalSamples) {
        const end = Math.min(start + chunkSamples, totalSamples);
        const size = end - start;

        // Pad last chunk if needed
        const leftChunk = new Float32Array(chunkSamples);
        const rightChunk = new Float32Array(chunkSamples);
        leftChunk.set(left.subarray(start, end));
        rightChunk.set(right.subarray(start, end));

        chunks.push({
            leftChunk,
            rightChunk,
            startSample: start,
            endSample: end,
            actualSize: size,
        });

        if (end >= totalSamples) break;
        start += stepSamples;
    }

    return chunks;
}

/**
 * 快速模板去人聲 (中置聲道抵消法)
 * 原理：大部分人聲位在正中間 (L=R)，透過 L-R 可抵消人聲
 * @param {Float32Array} left 
 * @param {Float32Array} right 
 * @returns {object} { vocals, accompaniment }
 */
export function quickVocalRemoval(left, right) {
    const len = left.length;
    const accompanimentLeft = new Float32Array(len);
    const accompanimentRight = new Float32Array(len);
    const vocalsLeft = new Float32Array(len);
    const vocalsRight = new Float32Array(len);

    for (let i = 0; i < len; i++) {
        // 伴奏 = L - R (簡單抵消)
        const diff = left[i] - right[i];
        accompanimentLeft[i] = diff;
        accompanimentRight[i] = diff;

        // 人聲 = (L + R) / 2 (取出中間成分)
        // 注意：這不是完美的人聲提取，僅作為快速模板的對照
        const center = (left[i] + right[i]) / 2;
        vocalsLeft[i] = center;
        vocalsRight[i] = center;
    }

    return {
        vocals: { left: vocalsLeft, right: vocalsRight },
        accompaniment: { left: accompanimentLeft, right: accompanimentRight }
    };
}

/**
 * 格式化時間 (MM:SS)
 */
export function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
}
