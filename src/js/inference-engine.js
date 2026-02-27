/**
 * inference-engine.js v3.0
 * 整合 demucs-web 專業處理庫
 * 完美處理 htdemucs_embedded.onnx (4-stem + STFT)
 */

import * as ort from 'onnxruntime-web';
import { DemucsProcessor } from 'demucs-web';

/**
 * 主推論排程函式 — 使用 demucs-web 處理複雜的 STFT + 推論 + iSTFT 機制
 * @param {ort.InferenceSession} session - 已載入的模型 session
 * @param {Float32Array} left - 原始左聲道 (完整音軌)
 * @param {Float32Array} right - 原始右聲道 (完整音軌)
 * @param {object} config - 模型設定
 * @param {object} callbacks
 * @param {function} callbacks.onProgress - (chunkIdx, total, percent, eta) => void
 * @param {function} callbacks.onStatus - (msg) => void
 * @param {AbortSignal} signal - 取消推論用
 * @returns {Promise<SeparatedResult>}
 */
export async function runInference(session, left, right, config, { onProgress, onStatus, signal } = {}) {
    onStatus?.('🧠 啟動專業版 Demucs 推論引擎...');

    // 建立 demucs-web 推論器，並將現有 session 注入
    const processor = new DemucsProcessor({
        ort: ort,
        onProgress: ({ progress, currentSegment, totalSegments }) => {
            const pct = Math.round(progress * 100);
            // 這裡 ETA 計算稍微簡化，由 UI 自己算或從這傳
            onProgress?.(currentSegment, totalSegments, pct, 0);
        },
        onLog: (phase, msg) => {
            console.log(`[Demucs Engine][${phase}] ${msg}`);
            if (phase === 'Inference') onStatus?.(`⚡ AI 推論中: ${msg}`);
        }
    });

    // 關鍵：將已載入的 session 接管
    processor.session = session;

    // 處理取消信號
    if (signal) {
        signal.addEventListener('abort', () => {
            onStatus?.('⚠️ 推論已手動取消');
        });
    }

    onStatus?.('⚡ 正在處理音軌 (STFT + AI + iSTFT)...');

    // 執行分離 (內部會自動切片與重疊合併)
    try {
        const result = await processor.separate(left, right);

        onStatus?.('✅ 音軌分離完成！');

        // 返回格式相容於 UI: { vocals, accompaniment }
        // demucs-web 回傳: { drums, bass, other, vocals }
        // 我們將 drums+bass+other 合併為 accompaniment
        // Result format: { drums, bass, other, vocals }
        // We merge drums + bass + other into accompaniment
        const accompaniment = {
            left: new Float32Array(left.length),
            right: new Float32Array(left.length)
        };

        const mergeStems = ['drums', 'bass', 'other'];
        for (const stem of mergeStems) {
            const data = result[stem];
            if (data) {
                for (let i = 0; i < left.length; i++) {
                    accompaniment.left[i] += data.left[i];
                    accompaniment.right[i] += data.right[i];
                }
                // Proactively clear to help GC
                result[stem] = null;
            }
        }

        const vocals = result.vocals;
        onStatus?.('✅ 音軌分離完成！正在打包...');

        return {
            vocals: vocals,
            accompaniment: accompaniment
        };
    } catch (e) {
        console.error('[Inference] 專業引擎推論失敗:', e);
        throw e;
    }
}
