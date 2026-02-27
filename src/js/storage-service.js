/**
 * storage-service.js
 * 使用 OPFS (Origin Private File System) 持久化音軌與歷史紀錄
 */

const HISTORY_KEY = 'stemsplit_history';

/**
 * 儲存音軌到 OPFS
 * @param {string} id - YouTube ID 或檔案雜湊
 * @param {string} type - 'vocals' | 'accompaniment'
 * @param {Blob} blob 
 */
export async function saveStem(id, type, blob) {
    try {
        if (!navigator.storage || !navigator.storage.getDirectory) {
            console.warn('[Storage] OPFS not supported, skipping persistence');
            return;
        }
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(id, { create: true });
        const fileHandle = await dir.getFileHandle(`${type}.wav`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        console.log(`[Storage] Saved ${type} for ${id}`);
    } catch (e) {
        console.error('[Storage] Save failed:', e);
    }
}

/**
 * 從 OPFS 讀取音軌
 * @returns {Promise<File | null>}
 */
export async function getStem(id, type) {
    try {
        if (!navigator.storage || !navigator.storage.getDirectory) return null;
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle(id);
        const fileHandle = await dir.getFileHandle(`${type}.wav`);
        return await fileHandle.getFile();
    } catch (e) {
        return null;
    }
}

/**
 * 更新歷史紀錄索引 (LocalStorage)
 */
export function addToHistory(item) {
    // item: { id, title, uploader, thumbnail, duration, timestamp }
    const history = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    // 移除重複
    const filtered = history.filter(h => h.id !== item.id);
    filtered.unshift({ ...item, timestamp: Date.now() });
    // 只保留最近 10 筆
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered.slice(0, 10)));
}

export function getHistory() {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
}

export async function clearAllData() {
    try {
        localStorage.removeItem(HISTORY_KEY);
        if (!navigator.storage || !navigator.storage.getDirectory) return;
        const root = await navigator.storage.getDirectory();

        // Iterate through all entries and remove them
        for await (const entry of root.values()) {
            await root.removeEntry(entry.name, { recursive: true });
        }
        console.log('[Storage] All local data cleared');
    } catch (e) {
        console.error('[Storage] Clear all failed:', e);
    }
}
