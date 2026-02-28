/**
 * inference-engine.js v5.0 (Worker Bridge)
 * 管理 Web Worker 推論進程，提供主執行緒不阻塞的 AI 分離介面
 */

let worker = null;

export async function runInference(session, left, right, config, { onProgress, onStatus, signal } = {}) {
    // 建立新 Worker (使用 Vite 語法)
    if (worker) worker.terminate();
    worker = new Worker(new URL('./inference-worker.js', import.meta.url), { type: 'module' });

    return new Promise((resolve, reject) => {
        // 監聽 Worker 訊息
        worker.onmessage = (e) => {
            const { type, payload } = e.data;

            if (type === 'INIT_DONE') {
                worker.postMessage({
                    type: 'SEPARATE',
                    payload: { left, right, config }
                }, [left.buffer, right.buffer]); // Transfer buffer to avoid copy
            }

            if (type === 'PROGRESS') {
                const { pct, msg } = payload;
                onProgress?.(0, 0, pct, 0); // Adapter to old progress signature
                onStatus?.(msg);
            }

            if (type === 'STATUS') {
                onStatus?.(payload);
            }

            if (type === 'DONE') {
                onStatus?.('✅ AI 分析完成！');
                worker.terminate();
                worker = null;
                resolve(payload);
            }

            if (type === 'ERROR') {
                worker.terminate();
                worker = null;
                reject(new Error(payload));
            }

            if (type === 'DOWNLOAD_PROGRESS') {
                const { loaded, total } = payload;
                onProgress?.(loaded, total, (loaded / total) * 100, 0);
            }
        };

        // 發送初始化訊息 (由 Worker 在內部載入模型以節省主執行緒記憶體)
        worker.postMessage({
            type: 'INIT',
            payload: {
                modelId: config.id,
                modelUrl: config.url,
                backend: document.body.dataset.backend || 'webgpu'
            }
        });

        // 取消監聽
        signal?.addEventListener('abort', () => {
            worker?.postMessage({ type: 'ABORT' });
            worker?.terminate();
            worker = null;
            reject(new Error('已取消'));
        });
    });
}
