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
 * 快速模板去人聲 v2.1 — 深度調教版 (Non-AI)
 *
 * 調教細節：
 *  1. 主聲道提取 (Center Channel Extraction)
 *  2. 帶通濾波 (Band-pass Filter): 300Hz - 8000Hz 保留人聲核心頻率，去除 Kick/Bass 低音干擾
 *  3. 立體聲擴展 (Stereo Widening): 為伴奏增加寬度，營造空間感
 *  4. 能量平衡控制，避免雜訊過大
 *
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @returns {{ vocals: {left, right}, accompaniment: {left, right} }}
 */
export function quickVocalRemoval(left, right) {
    const len = left.length;
    const vL = new Float32Array(len);
    const vR = new Float32Array(len);
    const aL = new Float32Array(len);
    const aR = new Float32Array(len);

    // 參數設計
    const ALPHA = 0.95; // 人聲抵消係數
    const WIDEN = 0.2;  // 伴奏擴寬係數

    // 帶通濾波器狀態 (簡單 IIR 模型)
    let lp = 0, hp = 0;
    const rcHP = 1.0 / (2 * Math.PI * 300);    // 300Hz High Pass
    const rcLP = 1.0 / (2 * Math.PI * 8500);   // 8500Hz Low Pass
    const dt = 1.0 / 44100;
    const alphaHP = rcHP / (rcHP + dt);
    const alphaLP = dt / (rcLP + dt);

    for (let i = 0; i < len; i++) {
        const l = left[i];
        const r = right[i];

        // 提取中置分量 (人聲通常在中間)
        const center = (l + r) * 0.5;

        // --- 人聲通道優化：帶通濾波 ---
        // High Pass 300Hz
        hp = alphaHP * (hp + center - (i > 0 ? (left[i - 1] + right[i - 1]) * 0.5 : 0));
        // Low Pass 8.5kHz
        lp = lp + alphaLP * (hp - lp);
        const filteredVocal = lp;

        vL[i] = filteredVocal;
        vR[i] = filteredVocal;

        // --- 伴奏通道優化：抵消中置 + 立體聲擴展 ---
        // 抵消 center 分量
        let sideL = l - center * ALPHA;
        let sideR = r - center * ALPHA;

        // 增加立體聲分離度 (Mid-Side processing)
        const mid = (sideL + sideR) * 0.5;
        const side = (sideL - sideR) * 0.5;

        // 增強 side，減弱 mid
        aL[i] = mid + side * (1.0 + WIDEN);
        aR[i] = mid - side * (1.0 + WIDEN);
    }

    // 最終裁切限幅
    for (let i = 0; i < len; i++) {
        aL[i] = Math.max(-1, Math.min(1, aL[i]));
        aR[i] = Math.max(-1, Math.min(1, aR[i]));
    }

    return {
        vocals: { left: vL, right: vR },
        accompaniment: { left: aL, right: aR }
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
