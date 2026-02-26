/**
 * opfs-cache.js
 * Origin Private File System 模型快取管理
 * 第一次下載後永久存於裝置，重開無需重新下載
 */

const CACHE_DIR = 'ort-models';

async function getRootDir() {
    return await navigator.storage.getDirectory();
}

async function getCacheDir() {
    const root = await getRootDir();
    return await root.getDirectoryHandle(CACHE_DIR, { create: true });
}

/**
 * 檢查模型是否已快取
 * @param {string} modelId
 * @returns {Promise<boolean>}
 */
export async function hasModel(modelId) {
    try {
        const dir = await getCacheDir();
        await dir.getFileHandle(modelId);
        return true;
    } catch {
        return false;
    }
}

/**
 * 將模型 ArrayBuffer 寫入 OPFS
 * @param {string} modelId
 * @param {ArrayBuffer} buffer
 */
export async function saveModel(modelId, buffer) {
    const dir = await getCacheDir();
    const fileHandle = await dir.getFileHandle(modelId, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(buffer);
    await writable.close();
}

/**
 * 從 OPFS 讀取模型
 * @param {string} modelId
 * @returns {Promise<ArrayBuffer>}
 */
export async function loadModel(modelId) {
    const dir = await getCacheDir();
    const fileHandle = await dir.getFileHandle(modelId);
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
}

/**
 * 刪除快取模型
 * @param {string} modelId
 */
export async function deleteModel(modelId) {
    try {
        const dir = await getCacheDir();
        await dir.removeEntry(modelId);
    } catch {
        // ignore
    }
}

/**
 * 取得快取大小（bytes）
 * @param {string} modelId
 * @returns {Promise<number>}
 */
export async function getModelSize(modelId) {
    try {
        const dir = await getCacheDir();
        const fileHandle = await dir.getFileHandle(modelId);
        const file = await fileHandle.getFile();
        return file.size;
    } catch {
        return 0;
    }
}

/**
 * 從 URL 下載模型並快取，帶進度回呼
 * @param {string} modelId
 * @param {string} url
 * @param {function} onProgress - (loaded: number, total: number) => void
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadAndCache(modelId, url, onProgress) {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`模型下載失敗: HTTP ${response.status}`);
    }

    const contentLength = response.headers.get('Content-Length');
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    const reader = response.body.getReader();
    const chunks = [];
    let loaded = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        if (onProgress) onProgress(loaded, total || loaded);
    }

    // 合併所有 chunks
    const totalBytes = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const buffer = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
    }

    const arrayBuffer = buffer.buffer;

    // 存入 OPFS
    try {
        await saveModel(modelId, arrayBuffer);
    } catch (e) {
        console.warn('OPFS 快取儲存失敗（空間不足？），繼續使用記憶體版本', e);
    }

    return arrayBuffer;
}

/**
 * 取得或下載模型
 * @param {string} modelId
 * @param {string} url
 * @param {function} onProgress
 * @returns {Promise<{buffer: ArrayBuffer, fromCache: boolean}>}
 */
export async function getOrDownloadModel(modelId, url, onProgress) {
    if (await hasModel(modelId)) {
        const buffer = await loadModel(modelId);
        return { buffer, fromCache: true };
    }
    const buffer = await downloadAndCache(modelId, url, onProgress);
    return { buffer, fromCache: false };
}
