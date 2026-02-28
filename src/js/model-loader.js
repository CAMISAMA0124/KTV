/**
 * model-loader.js v3.0
 * ONNX Runtime Web 模型載入，支援 WebGPU / WASM fallback
 *
 * 使用的模型：
 *  - timcsy/demucs-web-onnx — htdemucs_embedded.onnx (4-stem STFT)
 *    來源：https://huggingface.co/timcsy/demucs-web-onnx
 *    大小：約 180MB
 *
 * 關鍵設定：
 *  - ort.env.wasm.numThreads = 1  (避免 WASM 多執行緒崩潰)
 *  - 自動降級：WebGPU → WASM
 */

import * as ort from 'onnxruntime-web';
import { getOrDownloadModel } from './opfs-cache.js';
import { EnvStatus } from './env-check.js';

// ── 全局 ORT 環境設定 (只執行一次) ──────────────────────────
let _ortConfigured = false;
function configureOrtGlobal() {
    if (_ortConfigured) return;
    // 關鍵修復：numThreads=1 可避免 SharedArrayBuffer COOP 問題
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.simd = true;
    _ortConfigured = true;
    console.log('[ModelLoader] ORT env configured: numThreads=1, simd=true');
}

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
    // 初始化 ORT 全局設定
    configureOrtGlobal();

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
        extra: {
            session: { use_ort_model_bytes_directly: '1' }
        }
    };

    // Helper：帶 timeout 的 session 建立
    async function createSessionWithTimeout(data, opts, timeoutMs = 120000) {
        return Promise.race([
            ort.InferenceSession.create(data, opts),
            new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Session 建立超時 (120s)')), timeoutMs)
            )
        ]);
    }

    try {
        const uint8 = new Uint8Array(buffer);
        console.log(`[ModelLoader] Model size: ${(uint8.length / 1024 / 1024).toFixed(1)}MB, first 4 bytes: ${uint8[0]}, ${uint8[1]}, ${uint8[2]}, ${uint8[3]}`);

        cachedSession = await createSessionWithTimeout(uint8, sessionOptions);
        cachedModelKey = modelKey;
        onStatus?.('✅ AI 引擎啟動完成！');
        return { session: cachedSession, config };
    } catch (e) {
        // Fallback to WASM if GPU init fails
        if (backend !== EnvStatus.WASM) {
            console.warn(`${backend} 初始化失敗，降級到 WASM:`, e.message);
            onStatus?.(`⚠️ GPU 初始化失敗，改用 CPU 模式...`);
            const wasmOptions = {
                executionProviders: ['wasm'],
                graphOptimizationLevel: 'all',
                enableCpuMemArena: true,
            };
            try {
                const uint8 = new Uint8Array(buffer);
                cachedSession = await createSessionWithTimeout(uint8, wasmOptions, 180000);
                cachedModelKey = modelKey;
                onStatus?.('✅ CPU 模式啟動完成（較慢）');
                return { session: cachedSession, config };
            } catch (e2) {
                throw new Error(`GPU 和 CPU 模式均啟動失敗。GPU: ${e.message} | CPU: ${e2.message}`);
            }
        }
        throw new Error(`AI 引擎啟動失敗: ${e.message}。請嘗試重新整理頁面。`);
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
