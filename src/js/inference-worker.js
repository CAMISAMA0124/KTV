/**
 * inference-worker.js v1.0
 * Web Worker 封裝 Demucs AI 推論，避免阻塞主執行緒
 */

import * as ort from 'onnxruntime-web';
import { getOrDownloadModel } from './opfs-cache.js';
import { EnvStatus } from './env-check.js';

// ── 全局 ORT 設定 ──────────────────────────────────────────
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

// ── 核心分塊推論 (Manual 策略) ──────────────────────────────────
async function runManualInference(session, left, right, { onProgress, onStatus, signalAbort }) {
    const chunkSamples = 343980; // htdemucs_embedded 固定輸入大小
    const totalChunks = Math.ceil(left.length / chunkSamples);

    const outVocalL = new Float32Array(left.length);
    const outVocalR = new Float32Array(right.length);
    const outAccL = new Float32Array(left.length);
    const outAccR = new Float32Array(right.length);

    for (let i = 0; i < totalChunks; i++) {
        if (signalAbort.aborted) throw new Error('已取消');

        const start = i * chunkSamples;
        const end = Math.min(start + chunkSamples, left.length);
        const actualLen = end - start;

        const lChunk = new Float32Array(chunkSamples);
        const rChunk = new Float32Array(chunkSamples);
        lChunk.set(left.subarray(start, end));
        rChunk.set(right.subarray(start, end));

        const inputData = new Float32Array(2 * chunkSamples);
        inputData.set(lChunk, 0);
        inputData.set(rChunk, chunkSamples);

        const inputTensor = new ort.Tensor('float32', inputData, [1, 2, chunkSamples]);
        let outputMap;
        try {
            outputMap = await session.run({ mix: inputTensor });
            inputTensor.dispose?.();
        } catch (err) {
            console.error(`[Worker] Manual chunk ${i} failed:`, err.message);
            continue;
        }

        const outputKey = session.outputNames[0];
        const outTensor = outputMap[outputKey];
        const data = outTensor.data;

        // vocals = stem index 3
        const vocalOffset = 3 * 2 * actualLen;
        for (let t = 0; t < actualLen; t++) {
            outVocalL[start + t] = data[vocalOffset + t] || 0;
            outVocalR[start + t] = data[vocalOffset + actualLen + t] || 0;

            // Accompaniment = sum stems 0,1,2
            let aL = 0, aR = 0;
            for (let s = 0; s < 3; s++) {
                const soffset = s * 2 * actualLen;
                aL += data[soffset + t] || 0;
                aR += data[soffset + actualLen + t] || 0;
            }
            outAccL[start + t] = aL;
            outAccR[start + t] = aR;
        }
        outTensor.dispose?.();

        const pct = ((i + 1) / totalChunks) * 100;
        onProgress(pct, `AI 推論中: ${i + 1}/${totalChunks} 片段`);
        await new Promise(r => setTimeout(r, 0));
    }

    return {
        vocals: { left: outVocalL, right: outVocalR },
        accompaniment: { left: outAccL, right: outAccR }
    };
}

// ── 核心推論 (Demucs-Web 策略) ────────────────────────────────
async function runWithDemucsWeb(session, left, right, { onProgress, onStatus, signalAbort }) {
    const { DemucsProcessor } = await import('demucs-web');
    const processor = new DemucsProcessor({
        ort,
        onProgress: ({ progress, currentSegment, totalSegments }) => {
            onProgress(Math.round(progress * 100), `AI 處理中: 片段 ${currentSegment}/${totalSegments}`);
        },
        onLog: (phase, msg) => {
            if (phase === 'Inference') onStatus(`⚡ AI 推論中: 片段 ${msg}`);
        }
    });

    processor.session = session;
    if (signalAbort.aborted) throw new Error('已取消');

    const result = await processor.separate(left, right);

    onStatus('✅ 音軌分離完成！正在打包...');
    const accompaniment = {
        left: new Float32Array(left.length),
        right: new Float32Array(right.length)
    };

    const mergeStems = ['drums', 'bass', 'other'];
    for (const stem of mergeStems) {
        const data = result[stem];
        if (data) {
            for (let i = 0; i < left.length; i++) {
                accompaniment.left[i] += data.left?.[i] || 0;
                accompaniment.right[i] += data.right?.[i] || 0;
            }
            result[stem] = null;
        }
    }

    return {
        vocals: result.vocals,
        accompaniment
    };
}

// ── Worker 監聽 ─────────────────────────────────────────────
let abortCtrl = null;
let session = null;

self.onmessage = async (e) => {
    const { type, payload } = e.data;

    if (type === 'INIT') {
        try {
            const { modelId, modelUrl, backend } = payload;
            const status = (msg) => self.postMessage({ type: 'STATUS', payload: msg });

            status(`🔍 初始化引擎 (${backend})...`);

            const { buffer } = await getOrDownloadModel(modelId, modelUrl, (loaded, total) => {
                self.postMessage({ type: 'DOWNLOAD_PROGRESS', payload: { loaded, total } });
            });

            const sessionOptions = {
                executionProviders: backend === 'webgpu' ? ['webgpu', 'wasm'] : ['wasm'],
                graphOptimizationLevel: 'all',
                enableCpuMemArena: true,
            };

            const uint8 = new Uint8Array(buffer);
            session = await ort.InferenceSession.create(uint8, sessionOptions);
            self.postMessage({ type: 'INIT_DONE' });
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: `初始化失敗: ${err.message}` });
        }
    }

    if (type === 'SEPARATE') {
        try {
            const { left, right, config } = payload;
            abortCtrl = { aborted: false };

            const progress = (pct, msg) => self.postMessage({ type: 'PROGRESS', payload: { pct, msg } });
            const status = (msg) => self.postMessage({ type: 'STATUS', payload: msg });

            // 策略 1: Demucs-Web
            let result;
            try {
                result = await runWithDemucsWeb(session, left, right, { onProgress: progress, onStatus: status, signalAbort: abortCtrl });
            } catch (err) {
                if (abortCtrl.aborted) throw err;
                console.warn('[Worker] 主引擎失敗，自動啟動備援引擎...');
                result = await runManualInference(session, left, right, { onProgress: progress, onStatus: status, signalAbort: abortCtrl });
            }

            // 返回結果 (使用 Transferable 以避免複製大數據)
            self.postMessage({
                type: 'DONE',
                payload: result
            }, [
                result.vocals.left.buffer,
                result.vocals.right.buffer,
                result.accompaniment.left.buffer,
                result.accompaniment.right.buffer
            ]);
        } catch (err) {
            self.postMessage({ type: 'ERROR', payload: err.message });
        }
    }

    if (type === 'ABORT') {
        if (abortCtrl) abortCtrl.aborted = true;
    }
};
