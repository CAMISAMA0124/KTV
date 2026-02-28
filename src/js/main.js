/**
 * main.js v2.2
 * 應用入口 — 整合 KTV 模式與持久化讀取
 */

import { detectEnvironment, EnvStatus } from './env-check.js';
import { loadModel, MODEL_CONFIG, DEFAULT_MODEL } from './model-loader.js';
import { hasModel, getModelSize } from './opfs-cache.js';
import { decodeAudioFile, resampleBuffer, bufferToStereoArrays, formatDuration, quickVocalRemoval } from './audio-processor.js';
import { runInference } from './inference-engine.js';
import { encodeWAV } from './audio-merger.js';
import { UIController, UIState } from './ui-controller.js';
import { searchYouTube, extractFromURL, fetchVideoInfo, checkAPIHealth } from './youtube-service.js';
import { getStem } from './storage-service.js';

const ui = new UIController();
let envResult = null;
let session = null;
let modelConfig = null;
let currentAbortController = null;
let currentMetadata = null; // 暫存目前正在處理的 YouTube 資訊

// ─── 啟動 ────────────────────────────────────────────────────

async function init() {
    ui.setStatus('🔍 偵測裝置環境...');

    try {
        envResult = await detectEnvironment();
        ui.showEnvBadges(envResult);
    } catch (e) {
        envResult = { bestBackend: EnvStatus.WASM, hasWebGPU: false, isIOS: false, iOSVersion: {}, warnings: [] };
    }

    const modelId = MODEL_CONFIG[DEFAULT_MODEL].id;
    const cached = await hasModel(modelId);
    ui.setStatus(
        cached
            ? '⚡ 模型已就緒，請搜尋歌曲開始'
            : '首次使用需下載 AI 模型 (~180MB)'
    );

    checkAPIHealth().then(({ ok, ready }) => {
        ui.setAPIStatus(ok && ready, ok && !ready);
    });

    // 定期檢查狀態 (每 30 秒)
    setInterval(async () => {
        const status = await checkAPIHealth();
        ui.setAPIStatus(status.ok && status.ready, status.ok && !status.ready);
    }, 30000);
}

// ─── 統一處理流程 ────────────────────────────────────────────

/**
 * 統一處理流程
 * @param {File} file
 * @param {object} metadata
 * @param {string} mode - 'ai' | 'quick'
 */
async function processFile(file, metadata = null, mode = 'ai') {
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    const displayName = metadata?.title
        ? `${metadata.title.replace(/[\\/:*?"<>|]/g, '_')}.wav`
        : file.name;

    try {
        ui.setFileName(displayName);
        ui.setProgress(10);

        let decoded = await decodeAudioFile(file, msg => ui.setStatus(msg));
        const targetSampleRate = 44100; // Demucs v4 is 44.1kHz

        let resampled = await resampleBuffer(decoded, targetSampleRate, msg => ui.setStatus(msg));
        // Clear original decoded buffer to save memory
        decoded = null;

        const duration = resampled.duration;
        const { left, right } = bufferToStereoArrays(resampled);
        // Clear resampled buffer after extracting raw arrays
        resampled = null;

        let separation;

        if (mode === 'ai') {
            ui.setState(UIState.PROCESSING);
            ui.setStatus('🧠 啟動 AI 引擎...');

            // 使用 Worker 推論 (不阻塞主線程)
            separation = await runInference(null, left, right, MODEL_CONFIG[DEFAULT_MODEL], {
                signal,
                onProgress: (loaded, total, pct) => ui.setProgress(10 + pct * 0.8),
                onStatus: msg => ui.setStatus(msg),
            });
        } else {
            // 快速模式 (Template)
            ui.setStatus('⚡ 快速處理中 (模板模式)...');
            ui.setProgress(70);
            await new Promise(r => setTimeout(r, 300));
            separation = quickVocalRemoval(left, right);
            ui.setProgress(90);
        }

        if (signal.aborted) return;

        // 封裝結果
        const samplerate = 44100;
        ui.setStatus('📦 正在打包音軌...');

        const vocalsWav = encodeWAV(separation.vocals.left, separation.vocals.right, samplerate);
        const accompWav = encodeWAV(separation.accompaniment.left, separation.accompaniment.right, samplerate);

        const results = {
            vocalsBlob: new Blob([vocalsWav], { type: 'audio/wav' }),
            accompanimentBlob: new Blob([accompWav], { type: 'audio/wav' }),
            vocalsURL: URL.createObjectURL(new Blob([vocalsWav], { type: 'audio/wav' })),
            accompanimentURL: URL.createObjectURL(new Blob([accompWav], { type: 'audio/wav' })),
        };

        ui.setProgress(100);
        await ui.setResults(results, displayName, metadata);

    } catch (e) {
        if (signal?.aborted) { ui.reset(); return; }
        ui.showError(`處理失敗: ${e.message}`);
    }
}


// ─── URL 匯入流程 ────────────────────────────────────────────

async function processURL(url, mode = 'ai') {
    currentAbortController = new AbortController();
    const signal = currentAbortController.signal;

    try {
        ui.setState(UIState.PROCESSING);
        ui.setStatus('📥 從 YouTube 擷取音訊...');

        const metadata = currentMetadata || await fetchVideoInfo(url);

        const file = await extractFromURL(url, (pct) => {
            ui.setProgress(pct * 0.1); // 擷取佔進度 10%
            ui.setStatus(`📥 下載中 ${Math.round(pct)}%...`);
        }, signal);

        if (signal.aborted) return;

        // 開始核心分離流程
        await processFile(file, metadata, mode);

    } catch (e) {
        if (signal?.aborted) { ui.reset(); return; }
        ui.showError(`擷取失敗: ${e.message}。您可以試試【複製網址】手動下載後上傳。`);
    }
}

// ─── 事件綁定 ────────────────────────────────────────────────

ui.on('video-selected', (video) => {
    currentMetadata = video;
});

ui.on('mode-selected', (mode, file, video) => {
    if (file) {
        processFile(file, video, mode);
    } else if (video) {
        processURL(video.url, mode);
    } else {
        ui.showError('請先選擇一首歌曲或上傳本地音檔。');
    }
});


ui.on('url-search', async (query) => {
    try {
        const results = await searchYouTube(query);
        ui.showSearchResults(results);
    } catch (e) {
        ui.$urlInput.placeholder = '貼上網址或搜尋歌曲...';
        ui.setStatus(`❌ 搜尋失敗: ${e.message}`);
    }
});

ui.on('extract-requested', (video) => {
    currentMetadata = video;
    processURL(video.url);
});

ui.on('history-item-selected', async (item) => {
    ui.setStatus('📂 讀取本地暫存...');
    ui.setState(UIState.LOADING_MODEL);

    try {
        const vFile = await getStem(item.id, 'vocals');
        const aFile = await getStem(item.id, 'accompaniment');

        if (vFile && aFile) {
            // 封裝成 setResults 期待的格式
            const results = {
                vocalsBlob: vFile,
                accompanimentBlob: aFile,
                vocalsURL: URL.createObjectURL(vFile),
                accompanimentURL: URL.createObjectURL(aFile)
            };
            await ui.setResults(results, `${item.title}.wav`, item);
        } else {
            throw new Error('找不到暫存檔案，請重新分析');
        }
    } catch (e) {
        ui.showError(e.message);
    }
});

ui.on('cancel', () => {
    currentAbortController?.abort();
    ui.reset();
});

init().catch(console.error);
