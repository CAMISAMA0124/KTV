import { searchYouTube, fetchVideoInfo, isYouTubeURL, EngineConfig } from './youtube-service.js';
import { clearAllData, getHistory } from './storage-service.js';
import { ktv } from './ktv-player.js';

export const UIState = {
    IDLE: 'idle',
    LOADING_MODEL: 'loading_model',
    PROCESSING: 'processing',
    DONE: 'done',
    ERROR: 'error',
};

export class UIController {
    constructor() {
        this.state = UIState.IDLE;
        this._listeners = {};
        this._selectedVideo = null;
        this._selectedFile = null;
        this._currentPitch = 0;

        this.$urlInput = document.getElementById('url-input');
        this.$searchResults = document.getElementById('search-results');
        this.$statusText = document.getElementById('status-text');
        this.$progressWrap = document.getElementById('progress-wrap');
        this.$progressFill = document.getElementById('progress-bar');
        this.$resultPanel = document.getElementById('result-panel');

        this._bindEvents();
        setTimeout(() => { this._bindDrawerFileButtons(); this.renderHistory(); }, 50);
    }

    /* ── Event Bus ─────────────────────────────── */
    on(event, fn) {
        (this._listeners[event] = this._listeners[event] || []).push(fn);
    }
    emit(event, ...args) {
        (this._listeners[event] || []).forEach(fn => fn(...args));
    }

    /* ── 搜尋 ──────────────────────────────────── */
    _bindEvents() {
        /* 搜尋表單 */
        document.getElementById('search-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const val = this.$urlInput?.value.trim();
            if (!val) return;
            if (isYouTubeURL(val)) {
                this.setStatus('📡 讀取影片資訊...');
                const info = await fetchVideoInfo(val);
                info.url = val;
                this._showVideoPanel(info);
            } else {
                this.setStatus('🔍 搜尋中...');
                this.emit('url-search', val);
            }
        });

        /* KTV 控制項 */
        document.getElementById('guide-toggle')?.addEventListener('click', (e) => {
            const btn = e.currentTarget;
            const isOn = !btn.classList.contains('active');
            btn.classList.toggle('active', isOn);
            const label = btn.querySelector('.ktv-label');
            if (label) label.textContent = isOn ? '導唱 On' : '導唱 Off';
            ktv.toggleGuide(isOn);
        });
        document.getElementById('replay-btn')?.addEventListener('click', () => {
            ktv.replay();
        });
        document.getElementById('pitch-up')?.addEventListener('click', () => this._changePitch(1));
        document.getElementById('pitch-down')?.addEventListener('click', () => this._changePitch(-1));
        document.getElementById('reset-btn')?.addEventListener('click', () => location.reload());

        /* 抽屜開關 */
        document.getElementById('engine-btn')?.addEventListener('click', () => {
            document.getElementById('engine-drawer')?.classList.add('open');
            document.getElementById('drawer-overlay')?.classList.add('visible');
        });
        document.getElementById('close-drawer')?.addEventListener('click', this._closeDrawer.bind(this));
        document.getElementById('drawer-overlay')?.addEventListener('click', this._closeDrawer.bind(this));

        /* 清除快取 */
        document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
            if (confirm('確定清除暫存？')) { await clearAllData(); location.reload(); }
        });

        /* 模式選擇 */
        document.getElementById('mode-quick')?.addEventListener('click', () => {
            this.emit('mode-selected', 'quick', this._selectedFile, this._selectedVideo);
        });
        document.getElementById('mode-ai')?.addEventListener('click', () => {
            this.emit('mode-selected', 'ai', this._selectedFile, this._selectedVideo);
        });

        /* 保存按鈕觸發命名流程 */
        document.getElementById('save-btn')?.addEventListener('click', async () => {
            const currentTitle = document.getElementById('video-title')?.textContent || '未知歌曲';
            const name = prompt('請輸入要保存的歌名（這將用於雲端檢索）：', currentTitle);
            if (name) {
                this.emit('save-to-cloud', name);
                alert(`正在準備將「${name}」處理... (雲端功能開發中)`);
            }
        });
    }

    _closeDrawer() {
        document.getElementById('engine-drawer')?.classList.remove('open');
        document.getElementById('drawer-overlay')?.classList.remove('visible');
    }

    /* ── 設定抽屜內的上傳按鈕 ─────────────────── */
    _bindDrawerFileButtons() {
        const fileInput = document.getElementById('local-file-input');
        let pendingMode = 'quick';

        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            this._selectedFile = file;
            this._selectedVideo = null;
            e.target.value = '';            // 允許重複選同檔案
            this._closeDrawer();
            setTimeout(() => this.emit('mode-selected', pendingMode, file, null), 300);
        });

        document.getElementById('drawer-quick-btn')?.addEventListener('click', () => {
            pendingMode = 'quick'; fileInput?.click();
        });
        document.getElementById('drawer-ai-btn')?.addEventListener('click', () => {
            pendingMode = 'ai'; fileInput?.click();
        });
    }

    /* ── 搜尋結果 ─────────────────────────────── */
    showSearchResults(results) {
        if (!this.$searchResults) return;
        this.$searchResults.innerHTML = (results || []).map(v => `
            <div class="search-item"
                 onclick="window.ui._onSearchItemClick('${v.id}')"
                 style="display:flex;gap:12px;padding:12px;border-radius:16px;cursor:pointer;
                        background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);
                        margin-bottom:10px;transition:background .2s;">
                <img src="${v.thumbnail}" style="width:96px;height:54px;object-fit:cover;border-radius:10px;flex-shrink:0;">
                <div style="flex:1;display:flex;flex-direction:column;justify-content:center;overflow:hidden;">
                    <div style="font-weight:700;font-size:.9rem;overflow:hidden;display:-webkit-box;
                                -webkit-line-clamp:2;-webkit-box-orient:vertical;">${v.title}</div>
                    <div style="font-size:.75rem;opacity:.45;margin-top:3px;">${v.uploader || ''}</div>
                </div>
            </div>
        `).join('');
        this.$searchResults.style.display = 'block';

        // 隱藏影片預覽（確保搜尋結果是最上面的）
        document.getElementById('video-preview').style.display = 'none';
        document.getElementById('extract-btn').style.display = 'none';
        document.getElementById('mode-selection').style.display = 'none';
        this.setStatus(`✅ 找到 ${results.length} 個結果，點擊選擇`);
    }

    /* ── 搜尋結果點擊 ─────────────────────────── */
    async _onSearchItemClick(id) {
        console.log('[UI] Search item clicked, id=', id);
        this.setStatus('📡 讀取影片資訊...');

        // 立即隱藏搜尋清單，防止重複點
        if (this.$searchResults) this.$searchResults.style.display = 'none';

        const url = `https://www.youtube.com/watch?v=${id}`;
        try {
            const info = await fetchVideoInfo(url);
            info.url = url;
            console.log('[UI] Video info fetched:', info.title);
            this._showVideoPanel(info);
        } catch (err) {
            console.error('[UI] fetchVideoInfo error', err);
            // 就算 API 失敗，仍然用 ID 建立最低限度的資訊
            this._showVideoPanel({
                id,
                url,
                title: 'YouTube 歌曲',
                uploader: '',
                thumbnail: `https://img.youtube.com/vi/${id}/mqdefault.jpg`,
                duration: 0,
            });
        }
    }

    /* ── 影片預覽面板 (選歌後共用) ────────────── */
    async _showVideoPanel(video) {
        console.log('[UI] showVideoPanel for:', video.title);
        this._selectedVideo = video;
        this._selectedFile = null;

        const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.id}`;
        // 改為 MP4 下載頁
        const yt1sUrl = `https://yt1s.ai/zh-tw/youtube-to-mp4/?q=${encodeURIComponent(videoUrl)}`;

        // ✅ 自動複製 YouTube 連結到剪貼簿
        try {
            await navigator.clipboard.writeText(videoUrl);
            console.log('[UI] Copied to clipboard:', videoUrl);
        } catch (e) {
            console.warn('[UI] Clipboard copy failed:', e.message);
        }

        // 填入預覽資訊
        const thumb = document.getElementById('video-thumb');
        const title = document.getElementById('video-title');
        const preview = document.getElementById('video-preview');
        if (thumb) thumb.src = video.thumbnail;
        if (title) title.textContent = video.title;
        if (preview) preview.style.display = 'flex';

        // 醒目的「下載 MP4」大按鈕 + 複製成功提示
        const sub = document.querySelector('.video-sub');
        if (sub) {
            sub.innerHTML = `
                <div style="font-size:.75rem;color:#22c55e;margin-bottom:6px;font-weight:600;">
                    ✅ YouTube 連結已複製到剪貼簿
                </div>
                <a href="${yt1sUrl}"
                   target="_blank"
                   id="yt1s-download-btn"
                   style="display:inline-flex;align-items:center;gap:8px;
                          width:100%;box-sizing:border-box;
                          padding:13px 22px;
                          background:linear-gradient(135deg,#a78bfa,#818cf8);
                          color:#fff;font-weight:800;font-size:0.95rem;
                          border-radius:16px;text-decoration:none;
                          box-shadow:0 8px 20px rgba(130,100,220,0.4);
                          justify-content:center;">
                   ⬇️ 前往下載 MP4（yt1s）
                </a>
                <div style="font-size:.72rem;opacity:.45;margin-top:6px;text-align:center;">
                    下載完成後，點右上角 ⚙️ 設定 → 上傳分析
                </div>
            `;
        }

        // 隱藏模式選擇（引導先下載）
        document.getElementById('mode-selection')?.style.setProperty('display', 'none');
        document.getElementById('extract-btn')?.style.setProperty('display', 'none');

        this.emit('video-selected', video);
        this.setStatus('✅ 連結已複製，請前往 yt1s 下載 MP4！');
    }

    /* ── 舊有相容方法 ─────────────────────────── */
    async _selectVideoById(id) { await this._onSearchItemClick(id); }
    _selectVideo(video) { this._showVideoPanel(video); }

    /* ── 音調 ─────────────────────────────────── */
    _changePitch(dir) {
        this._currentPitch = Math.max(-5, Math.min(5, this._currentPitch + dir));
        const el = document.getElementById('pitch-val');
        if (el) el.textContent = this._currentPitch === 0 ? '原調'
            : (this._currentPitch > 0 ? `+${this._currentPitch}` : `${this._currentPitch}`);
        ktv.setPitch(this._currentPitch);
    }

    /* ── 狀態機 ───────────────────────────────── */
    setState(state) {
        this.state = state;
        document.body.dataset.uiState = state;

        const isWork = state === 'processing' || state === 'loading_model';
        if (this.$progressWrap) this.$progressWrap.style.display = isWork ? 'block' : 'none';

        if (state === 'done') {
            if (this.$resultPanel) this.$resultPanel.style.display = 'flex';
            // 完成後隱藏輸入區
            document.querySelector('.input-card')?.style.setProperty('display', 'none');
            document.getElementById('mode-selection')?.style.setProperty('display', 'none');
            // 確保 overlay 移除
            const overlay = document.getElementById('video-overlay');
            if (overlay) { overlay.classList.remove('active'); overlay.style.display = 'none'; }
        }
    }

    setStatus(msg) { if (this.$statusText) this.$statusText.textContent = msg; }
    setProgress(pct) {
        const p = Math.round(pct);
        console.log(`[UI] Progress update: ${p}%`);
        if (this.$progressFill) this.$progressFill.style.width = `${p}%`;
        const pctEl = document.getElementById('progress-pct');
        if (pctEl) {
            pctEl.textContent = `${p}%`;
        } else {
            console.warn('[UI] progress-pct element not found!');
        }
    }
    setFileName(name) { const el = document.getElementById('video-title'); if (el) el.textContent = name; }

    setAPIStatus(ok, isWarming = false) {
        const dot = document.getElementById('api-status-dot');
        const sdot = document.getElementById('search-status-dot');
        const stxt = document.getElementById('search-status-text');
        if (dot) dot.className = `api-status-dot ${ok ? 'online' : isWarming ? 'warming' : 'offline'}`;
        if (sdot) sdot.style.background = ok ? '#22c55e' : isWarming ? '#eab308' : '#ef4444';
        if (stxt) stxt.textContent = ok ? '服務正常' : isWarming ? '後端暖機中...' : '後端連接失敗';
    }

    setModelCacheStatus(fromCache, mb) {
        const el = document.getElementById('model-cache-status');
        if (el) { el.textContent = `${fromCache ? '⚡ 已就緒' : '📥 已下載'} (${Math.round(mb)}MB)`; el.style.display = 'block'; }
    }

    showEnvBadges(env) {
        const c = document.getElementById('env-badges');
        if (c) c.innerHTML = `<span class="badge ${env.hasWebGPU ? 'badge-gpu' : 'badge-wasm'}">${env.hasWebGPU ? 'WebGPU ⚡' : 'WASM'}</span>`;
    }

    /* ── 分析完成，載入播放器 ─────────────────── */
    async setResults(results, fileName, metadata = null) {
        // 先顯示結果面板
        this.setState(UIState.DONE);

        const vBuffer = await this._blobToAudioBuffer(results.vocalsBlob);
        const aBuffer = await this._blobToAudioBuffer(results.accompanimentBlob);

        // 決定播放來源
        let source = null;
        if (metadata?.id && String(metadata.id).length === 11) {
            // YouTube 11 碼 ID → YT 播放器
            source = String(metadata.id);
            console.log('[UI] setResults → YouTube ID:', source);
        } else if (this._selectedFile &&
            (this._selectedFile.type.startsWith('video') ||
                /\.(mp4|mov|m4v|mkv)$/i.test(this._selectedFile.name))) {
            // 本地影片 → blob URL
            source = URL.createObjectURL(this._selectedFile);
            console.log('[UI] setResults → local video blob');
        } else {
            // 純音訊模式
            source = null;
            console.log('[UI] setResults → audio-only mode');
        }

        await ktv.load(vBuffer, aBuffer, source);
        this.setStatus('🎉 準備完成，開始熱唱！');

        // ✅ 根據模式決定是否顯示保存按鈕
        const isAI = metadata?.isAI === true;
        const saveBtn = document.getElementById('save-btn');
        if (saveBtn) {
            saveBtn.style.display = isAI ? 'flex' : 'none';
        }

        // 三重保險：無論如何都隱藏黑畫面覆蓋層
        const overlay = document.getElementById('video-overlay');
        if (overlay) { overlay.style.display = 'none'; overlay.classList.remove('active'); }
    }

    showError(msg) {
        this.setStatus(`❌ ${msg}`);
        this.setState(UIState.ERROR);
        setTimeout(() => this.setState(UIState.IDLE), 5000);
    }

    reset() { location.reload(); }

    async _blobToAudioBuffer(blob) {
        // 重要：確保 ktv.ctx 已經建立，否則 decodeAudioData 會報錯 (這就是造成黑畫面的主因)
        if (!ktv.ctx) ktv.initAudioChain();

        try {
            const ab = await blob.arrayBuffer();
            return await ktv.ctx.decodeAudioData(ab);
        } catch (e) {
            console.error('[UI] Audio decode failed:', e);
            throw e;
        }
    }

    /* ── 歷史紀錄 ─────────────────────────────── */
    renderHistory() {
        const container = document.getElementById('history-list');
        if (!container) return;
        try {
            const history = getHistory ? getHistory() : [];
            if (!history || history.length === 0) {
                container.innerHTML = '<div style="opacity:.4;padding:20px;text-align:center;font-size:.9rem;">暫無歷史紀錄</div>';
                return;
            }
            container.innerHTML = history.map(item => `
                <div class="history-card" onclick="window.ui.emit('history-item-selected', ${JSON.stringify(item).replace(/"/g, '&quot;')})">
                    <img class="history-thumb" src="${item.thumbnail || ''}" alt="">
                    <div class="history-title">${item.title || '未知歌曲'}</div>
                </div>
            `).join('');
        } catch (e) {
            container.innerHTML = '<div style="opacity:.4;padding:20px;text-align:center;">暫無歷史紀錄</div>';
        }
    }

    _initEngineSettings() {
        const config = EngineConfig.load();
        const map = { 'cookie-input': 'cookies', 'cloud-backend-input': 'cloud_backend', 'backend-input': 'backend' };
        Object.entries(map).forEach(([id, key]) => {
            const el = document.getElementById(id);
            if (el) el.value = config[key] || '';
        });
    }
}
