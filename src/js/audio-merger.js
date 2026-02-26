/**
 * audio-merger.js
 * 無縫拼接推論結果 → 輸出 WAV Blob
 * 使用 overlap-add 方法消除區塊邊界的接縫噪音
 */

/**
 * 產生 Hann 視窗 (overlap-add 用)
 * @param {number} size
 * @returns {Float32Array}
 */
function hannWindow(size) {
    const win = new Float32Array(size);
    for (let i = 0; i < size; i++) {
        win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return win;
}

/**
 * Overlap-Add 拼接音訊 chunks
 * @param {Array} chunkResults - from runInference()
 * @param {string} stem - 'vocals' | 'accompaniment'
 * @param {number} totalSamples - 原始音訊總樣本數
 * @param {number} overlapSamples - overlap 的樣本數
 * @returns {{ left: Float32Array, right: Float32Array }}
 */
export function mergeChunks(chunkResults, stem, totalSamples, overlapSamples) {
    const outLeft = new Float32Array(totalSamples);
    const outRight = new Float32Array(totalSamples);
    const weightSum = new Float32Array(totalSamples);

    for (let i = 0; i < chunkResults.length; i++) {
        const chunk = chunkResults[i];
        const stemData = chunk[stem];
        const chunkSize = chunk.actualSize;
        const start = chunk.startSample;

        // 為每個 chunk 計算視窗函數（smooth boundaries）
        const win = hannWindow(chunkSize);

        for (let s = 0; s < chunkSize; s++) {
            const idx = start + s;
            if (idx >= totalSamples) break;
            const w = win[s];
            outLeft[idx] += stemData.left[s] * w;
            outRight[idx] += stemData.right[s] * w;
            weightSum[idx] += w;
        }
    }

    // 正規化（消除視窗函數造成的增益變化）
    for (let i = 0; i < totalSamples; i++) {
        if (weightSum[i] > 1e-8) {
            outLeft[i] /= weightSum[i];
            outRight[i] /= weightSum[i];
        }
    }

    return { left: outLeft, right: outRight };
}

/**
 * 將 Float32Array (PCM) 編碼為 WAV ArrayBuffer
 * @param {Float32Array} left
 * @param {Float32Array} right
 * @param {number} sampleRate
 * @returns {ArrayBuffer}
 */
export function encodeWAV(left, right, sampleRate) {
    const numChannels = 2;
    const numSamples = left.length;
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataSize = numSamples * blockAlign;
    const bufferSize = 44 + dataSize;

    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    // WAV Header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);          // Subchunk1Size
    view.setUint16(20, 1, true);           // PCM = 1
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    // PCM Data (interleaved L/R, int16)
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
        const l = Math.max(-1, Math.min(1, left[i]));
        const r = Math.max(-1, Math.min(1, right[i]));
        view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7FFF, true);
        offset += 2;
        view.setInt16(offset, r < 0 ? r * 0x8000 : r * 0x7FFF, true);
        offset += 2;
    }

    return buffer;
}

function writeString(view, offset, str) {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

/**
 * 建立可播放 / 可下載的 Blob URL
 * @param {ArrayBuffer} wavBuffer
 * @returns {string} blob URL
 */
export function createAudioBlobURL(wavBuffer) {
    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
    return URL.createObjectURL(blob);
}

/**
 * 完整的後處理流程
 * @param {Array} chunkResults
 * @param {object} options - { totalSamples, overlapSamples, sampleRate }
 * @returns {{ vocalsURL: string, accompanimentURL: string, vocalsBlob: Blob, accompanimentBlob: Blob }}
 */
export function postProcess(chunkResults, { totalSamples, overlapSamples, sampleRate }) {
    const vocals = mergeChunks(chunkResults, 'vocals', totalSamples, overlapSamples);
    const accomp = mergeChunks(chunkResults, 'accompaniment', totalSamples, overlapSamples);

    const vocalsWav = encodeWAV(vocals.left, vocals.right, sampleRate);
    const accompWav = encodeWAV(accomp.left, accomp.right, sampleRate);

    const vocalsBlob = new Blob([vocalsWav], { type: 'audio/wav' });
    const accompanimentBlob = new Blob([accompWav], { type: 'audio/wav' });

    return {
        vocalsBlob,
        accompanimentBlob,
        vocalsURL: URL.createObjectURL(vocalsBlob),
        accompanimentURL: URL.createObjectURL(accompanimentBlob),
    };
}
