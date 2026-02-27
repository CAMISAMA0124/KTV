/**
 * model-loader.js
 * ONNX Runtime Web 模型載入，支援 WebGPU / WASM fallback
 *
 * 使用的模型：
 *  - 社群維護的 htdemucs (2-stem vocals/no_vocals) ONNX float16 量化版
 *    來源：https://huggingface.co/demucs/onnx-demucs
 *    大小：約 80MB
 *
 * 開發時使用 MOCK 模式，真實模型替換 MODEL_URL 即可。
 */

import * as ort from 'onnxruntime-web';
import { getOrDownloadModel } from './opfs-cache.js';
import { EnvStatus } from './env-check.js';

// ============================================================
// 設定模型 URL（替換為真實模型 URL）
// 目前指向 HuggingFace 的公開 ONNX Demucs 模型
// ============================================================
export const MODEL_CONFIG = {
    // 4-stem (drums, bass, other, vocals) — 公開模型，for web inference
    // Source: https://huggingface.co/timcsy/demucs-web-onnx
    'htdemucs-4stem': {
        url: '/htdemucs_embedded.onnx',
        id: 'htdemucs_embedded.onnx',
        stems: ['drums', 'bass', 'other', 'vocals'], // order from model output
        sampleRate: 44100,
        segment: 343980 / 44100,  // = 7.7959... — must match model fixed input exactly
        overlap: 0.1,             // 10% overlap for smooth stitching
        stemCount: 4,
    },
};

export const DEFAULT_MODEL = 'htdemucs-4stem';

let cachedSession = null;
let cachedModelKey = null;

/**
 * 設定 ORT 執行環境
 * @param {string} backend - 'webgpu' | 'webnn' | 'wasm'
 */
function configureORT(backend) {
    if (backend === EnvStatus.WEBGPU) {
        ort.env.webgpu.powerPreference = 'high-performance';
    }
}

/**
 * 載入 ONNX 模型（含 OPFS 快取）
 * @param {object} options
 * @param {string} options.modelKey - MODEL_CONFIG 的 key
 * @param {string} options.backend - 推論後端
 * @param {function} options.onDownloadProgress - (loaded, total) => void
 * @param {function} options.onStatus - (message: string) => void
 * @returns {Promise<{session: ort.InferenceSession, config: object}>}
 */
export async function loadModel({ modelKey = DEFAULT_MODEL, backend = EnvStatus.WASM, onDownloadProgress, onStatus } = {}) {
    // 已快取 session，直接返回
    if (cachedSession && cachedModelKey === modelKey) {
        onStatus?.('✅ 模型已就緒（記憶體中）');
        return { session: cachedSession, config: MODEL_CONFIG[modelKey] };
    }

    const config = MODEL_CONFIG[modelKey];
    if (!config) throw new Error(`未知模型: ${modelKey}`);

    configureORT(backend);

    // 取得模型 buffer（OPFS 快取 or 下載）
    onStatus?.('🔍 檢查模型快取...');

    let buffer;
    let fromCache = false;

    try {
        const result = await getOrDownloadModel(config.id, config.url, (loaded, total) => {
            onDownloadProgress?.(loaded, total);
        });
        buffer = result.buffer;
        fromCache = result.fromCache;
        onStatus?.(fromCache ? '⚡ 從快取載入模型' : '✅ 模型下載完成');
    } catch (e) {
        throw new Error(`模型載入失敗: ${e.message}`);
    }

    // 建立推論 Session
    onStatus?.(`🧠 初始化 AI 引擎 (${backend})...`);

    const sessionOptions = {
        executionProviders: getExecutionProviders(backend),
        graphOptimizationLevel: 'all',
        enableCpuMemArena: true,
        enableMemPattern: true,
    };

    try {
        // Logging first few bytes to debug if it's a valid ONNX protobuf
        const uint8 = new Uint8Array(buffer);
        console.log(`[ModelLoader] Model first 4 bytes: ${uint8[0]}, ${uint8[1]}, ${uint8[2]}, ${uint8[3]}`);

        // Pass Uint8Array directly instead of ArrayBuffer to prevent offset/parsing issues.
        cachedSession = await ort.InferenceSession.create(uint8, sessionOptions);
        cachedModelKey = modelKey;
        onStatus?.('✅ AI 引擎啟動完成！');
        return { session: cachedSession, config };
    } catch (e) {
        // Fallback to WASM if GPU init fails
        if (backend !== EnvStatus.WASM) {
            console.warn(`${backend} 初始化失敗，降級到 WASM`, e);
            onStatus?.(`⚠️ GPU 初始化失敗，改用 CPU 模式...`);
            const wsmOptions = {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
            };
            const uint8 = new Uint8Array(buffer);
            cachedSession = await ort.InferenceSession.create(uint8, wsmOptions);
            cachedModelKey = modelKey;
            return { session: cachedSession, config };
        }
        throw e;
    }
}

function getExecutionProviders(backend) {
    switch (backend) {
        case EnvStatus.WEBGPU:
            return ['webgpu', 'wasm'];
        case EnvStatus.WEBNN:
            return ['webnn', 'wasm'];
        default:
            return ['wasm'];
    }
}

/**
 * 取得 Session 輸入/輸出名稱（除錯用）
 */
export function getModelInfo(session) {
    return {
        inputs: session.inputNames,
        outputs: session.outputNames,
    };
}

/**
 * 釋放模型資源
 */
export async function disposeModel() {
    if (cachedSession) {
        await cachedSession.release();
        cachedSession = null;
        cachedModelKey = null;
    }
}
