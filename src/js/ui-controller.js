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
    _showVideoPanel(video) {
        console.log('[UI] showVideoPanel for:', video.title);
        this._selectedVideo = video;
        this._selectedFile = null;

        const videoUrl = video.url || `https://www.youtube.com/watch?v=${video.id}`;

        // 填入預覽資訊
        const thumb = document.getElementById('video-thumb');
        const title = document.getElementById('video-title');
        const preview = document.getElementById('video-preview');
        if (thumb) thumb.src = video.thumbnail;
        if (title) title.textContent = video.title;
        if (preview) preview.style.display = 'flex';

        // 手動下載連結
        const sub = document.querySelector('.video-sub');
        if (sub) {
            sub.innerHTML = `
                <a href="https://yt1s.ai/zh-tw/youtube-mp3?q=${encodeURIComponent(videoUrl)}"
                   target="_blank"
                   style="color:var(--accent);font-weight:700;font-size:.8rem;text-decoration:underline;">
                   ➜ 手動下載音訊 (yt1s)
                </a>
            `;
        }

        // 顯示模式選擇卡片
        const modeSelection = document.getElementById('mode-selection');
        if (modeSelection) modeSelection.style.display = 'block';

        // 隱藏「匯入按鈕」(現在直接點模式就好，不需要中間步驟)
        const extractBtn = document.getElementById('extract-btn');
        if (extractBtn) extractBtn.style.display = 'none';

        this.emit('video-selected', video);
        this.setStatus('✅ 請選擇分析模式');
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
    setProgress(pct) { if (this.$progressFill) this.$progressFill.style.width = `${pct}%`; }
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
        this.setState(UIState.DONE);

        const vBuffer = await this._blobToAudioBuffer(results.vocalsBlob);
        const aBuffer = await this._blobToAudioBuffer(results.accompanimentBlob);

        // 決定播放來源
        let source = metadata?.id || null;
        if (!source && this._selectedFile &&
            (this._selectedFile.type.startsWith('video') ||
                /\.(mp4|mov|m4v|mkv)$/i.test(this._selectedFile.name))) {
            source = URL.createObjectURL(this._selectedFile);
        }

        console.log('[UI] setResults: source =', source);
        await ktv.load(vBuffer, aBuffer, source);
        this.setStatus('🎉 準備完成，開始熱唱！');

        // 再次確保 overlay 不擋畫面
        const overlay = document.getElementById('video-overlay');
        if (overlay) { overlay.classList.remove('active'); overlay.style.display = 'none'; }
    }

    showError(msg) {
        this.setStatus(`❌ ${msg}`);
        this.setState(UIState.ERROR);
        setTimeout(() => this.setState(UIState.IDLE), 5000);
    }

    reset() { location.reload(); }

    async _blobToAudioBuffer(blob) {
        const ab = await blob.arrayBuffer();
        return await ktv.ctx.decodeAudioData(ab);
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
