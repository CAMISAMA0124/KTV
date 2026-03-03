/**
 * cloud-service.js
 * 透過 Supabase REST API 實作雲端儲存與檢索
 * 免信用卡，支援 1GB 免費存儲與資料庫索引
 */

export class CloudService {
    constructor() {
        this.url = localStorage.getItem('ktv_supabase_url') || '';
        this.key = localStorage.getItem('ktv_supabase_key') || '';
        this.isInitialized = !!(this.url && this.key);
    }

    /**
     * 上傳音檔至 Supabase Storage
     */
    async uploadToSupabase(title, vocalsBlob, accompanimentBlob, metadata = {}) {
        if (!this.isInitialized) throw new Error('請先配置 Supabase URL 與 API Key');

        const songId = metadata.id || `local_${Date.now()}`;
        console.log(`[Cloud] Uploading song: ${title} (...)`);

        try {
            // 1. 上傳人聲
            const vUrl = await this._uploadFile(`songs/${songId}_vocals.wav`, vocalsBlob);
            // 2. 上傳伴奏
            const aUrl = await this._uploadFile(`songs/${songId}_accomp.wav`, accompanimentBlob);

            // 3. 在資料庫建立索引
            await this._insertToDB({
                yid: metadata.id || '',
                title: title,
                vocals_url: vUrl,
                accomp_url: aUrl,
                thumbnail: metadata.thumbnail || '',
                duration: metadata.duration || 0
            });

            return { vUrl, aUrl };
        } catch (e) {
            console.error('[Cloud] Supabase Error:', e.message);
            throw e;
        }
    }

    async _uploadFile(path, blob) {
        const uploadUrl = `${this.url}/storage/v1/object/ktv-songs/${path}`;
        const res = await fetch(uploadUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.key}`,
                'apikey': this.key,
                'Content-Type': blob.type
            },
            body: blob
        });

        if (!res.ok) {
            // 如果檔案已存在，嘗試直接獲取連結
            if (res.status === 400) return `${this.url}/storage/v1/object/public/ktv-songs/${path}`;
            throw new Error('Storage Upload Failed');
        }
        return `${this.url}/storage/v1/object/public/ktv-songs/${path}`;
    }

    async _insertToDB(data) {
        const dbUrl = `${this.url}/rest/v1/library`;
        const res = await fetch(dbUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.key}`,
                'apikey': this.key,
                'Content-Type': 'application/json',
                'Prefer': 'return=representation'
            },
            body: JSON.stringify(data)
        });
        if (!res.ok) console.warn('[Cloud] DB Index failed, but files are uploaded.');
    }

    /**
     * 搜尋雲端曲庫
     */
    async searchCloudLibrary(query) {
        if (!this.isInitialized) return [];

        const dbUrl = `${this.url}/rest/v1/library?title=ilike.*${encodeURIComponent(query)}*&select=*&limit=20`;
        try {
            const res = await fetch(dbUrl, {
                headers: { 'Authorization': `Bearer ${this.key}`, 'apikey': this.key }
            });
            if (!res.ok) return [];
            return await res.json();
        } catch (e) {
            return [];
        }
    }
}

export const cloud = new CloudService();
