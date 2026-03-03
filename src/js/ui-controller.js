import { searchYouTube, fetchVideoInfo, isYouTubeURL, EngineConfig } from './youtube-service.js';
import { saveStem, addToHistory, getHistory, clearAllData } from './storage-service.js';
import { ktv } from './ktv-player.js';

export const UIState = {
    IDLE: 'idle',
    LOADING_MODEL: 'loading_model',
    UPLOADING: 'uploading',
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

        // DOM refs
        this.$urlInput = document.getElementById('url-input');
        this.$searchResults = document.getElementById('search-results');
        this.$statusText = document.getElementById('status-text');
        this.$progressWrap = document.getElementById('progress-wrap');
        this.$progressFill = document.getElementById('progress-bar');
        this.$resultPanel = document.getElementById('result-panel');
        this.$videoOverlay = document.getElementById('video-overlay');

        this._bindEvents();
        setTimeout(() => {
            this.renderHistory();
            this._initEngineSettings();
            this._bindDrawerFileButtons();
        }, 100);
    }

    _bindDrawerFileButtons() {
        const fileInput = document.getElementById('local-file-input');
        let pendingMode = 'quick';
        let isDrawerTrigger = false;

        fileInput?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            this._selectedFile = file;
            this._selectedVideo = null;

            if (isDrawerTrigger) {
                document.getElementById('engine-drawer')?.classList.remove('open');
                document.getElementById('drawer-overlay')?.classList.remove('visible');
                setTimeout(() => this.emit('mode-selected', pendingMode, file, null), 200);
            } else {
                const modeSel = document.getElementById('mode-selection');
                if (modeSel) modeSel.style.display = 'block';
                this.setStatus(`✅ 已選擇: ${file.name}`);
            }
            isDrawerTrigger = false;
        });

        document.getElementById('drawer-quick-btn')?.addEventListener('click', () => {
            pendingMode = 'quick';
            isDrawerTrigger = true;
            fileInput?.click();
        });

        document.getElementById('drawer-ai-btn')?.addEventListener('click', () => {
            pendingMode = 'ai';
            isDrawerTrigger = true;
            fileInput?.click();
        });
    }

    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }
    emit(event, ...args) {
        (this._listeners[event] || []).forEach(fn => fn(...args));
    }

    _bindEvents() {
        document.getElementById('mode-ai')?.addEventListener('click', () => {
            this.emit('mode-selected', 'ai', this._selectedFile, this._selectedVideo);
        });
        document.getElementById('mode-quick')?.addEventListener('click', () => {
            this.emit('mode-selected', 'quick', this._selectedFile, this._selectedVideo);
        });

        document.getElementById('reset-btn')?.addEventListener('click', () => location.reload());

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

        document.getElementById('search-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const val = this.$urlInput?.value.trim();
            if (!val) return;
            if (isYouTubeURL(val)) {
                const info = await fetchVideoInfo(val);
                this._selectVideo(info);
            } else {
                this.emit('url-search', val);
            }
        });

        document.getElementById('engine-btn')?.addEventListener('click', () => {
            document.getElementById('engine-drawer')?.classList.add('open');
            document.getElementById('drawer-overlay')?.classList.add('visible');
        });

        document.getElementById('close-drawer')?.addEventListener('click', () => {
            document.getElementById('engine-drawer')?.classList.remove('open');
            document.getElementById('drawer-overlay')?.classList.remove('visible');
        });

        document.getElementById('extract-btn')?.addEventListener('click', () => {
            document.getElementById('mode-selection').style.display = 'block';
            document.getElementById('extract-btn').style.display = 'none';
        });

        document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
            if (confirm('確定清除暫存？')) { await clearAllData(); location.reload(); }
        });
    }

    _changePitch(dir) {
        this._currentPitch = Math.max(-5, Math.min(5, this._currentPitch + dir));
        const valEl = document.getElementById('pitch-val');
        if (valEl) {
            valEl.textContent = this._currentPitch === 0 ? '原調' :
                (this._currentPitch > 0 ? `+${this._currentPitch}` : this._currentPitch);
        }
        ktv.setPitch(this._currentPitch);
    }

    showSearchResults(results) {
        if (!this.$searchResults) return;
        this.$searchResults.innerHTML = (results || []).map(v => `
            <div class="search-item" onclick="window.ui._selectVideoById('${v.id}')" style="display:flex; gap:12px; margin-bottom:12px; cursor:pointer; background:rgba(255,255,255,0.03); padding:12px; border-radius:16px; border:1px solid rgba(255,255,255,0.05); transition:0.3s;">
                <img src="${v.thumbnail}" style="width:100px; height:56px; object-fit:cover; border-radius:10px; box-shadow:0 4px 10px rgba(0,0,0,0.3);">
                <div style="flex:1; display:flex; flex-direction:column; justify-content:center;">
                    <div style="font-weight:700; font-size:0.95rem; line-height:1.3; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:#fff;">${v.title}</div>
                    <div style="font-size:0.75rem; opacity:0.5; margin-top:4px;">${v.uploader}</div>
                </div>
            </div>
        `).join('');
        this.$searchResults.style.display = 'block';
    }

    async _selectVideoById(id) {
        this.setStatus('📡 讀取影片資訊...');
        const info = await fetchVideoInfo(`https://www.youtube.com/watch?v=${id}`);
        this._selectVideo(info);
    }

    _selectVideo(video) {
        this._selectedVideo = video;
        this._selectedFile = null;
        const preview = document.getElementById('video-preview');
        const thumb = document.getElementById('video-thumb');
        const title = document.getElementById('video-title');
        if (preview) preview.style.display = 'flex';
        if (thumb) thumb.src = video.thumbnail;
        if (title) title.textContent = video.title;

        // 顯示按鈕
        const extractBtn = document.getElementById('extract-btn');
        if (extractBtn) {
            extractBtn.style.display = 'block';
            extractBtn.textContent = '🚀 下載並匯入 AI 分離';
        }

        const modeSelection = document.getElementById('mode-selection');
        if (modeSelection) modeSelection.style.display = 'none'; // 讓用戶點擊匯入後才顯示

        // 加入外部下載連結 (用戶要求的)
        const sub = document.getElementById('video-sub') || document.querySelector('.video-sub');
        if (sub) {
            sub.innerHTML = `
                <a href="https://yt1s.com/en/youtube-to-mp3?q=${encodeURIComponent(video.url)}" target="_blank" style="color:var(--accent); text-decoration:underline; font-size:0.8rem; margin-right:10px;">➜ 按此手動下載音訊</a>
                <span id="video-duration">${video.duration || ''}</span>
            `;
        }

        this.emit('video-selected', video);
    }

    setState(state) {
        this.state = state;
        document.body.dataset.uiState = state;
        if (this.$progressWrap) this.$progressWrap.style.display = (state === 'processing' || state === 'loading_model') ? 'block' : 'none';
        if (state === 'done' && this.$resultPanel) {
            this.$resultPanel.style.display = 'flex';
            const inputCard = document.querySelector('.input-card');
            if (inputCard) inputCard.style.display = 'none';
        }
    }

    setStatus(msg) { if (this.$statusText) this.$statusText.textContent = msg; }
    setProgress(pct) { if (this.$progressFill) this.$progressFill.style.width = `${pct}%`; }

    setAPIStatus(ok, isWarming = false) {
        const dot = document.getElementById('api-status-dot');
        const searchDot = document.getElementById('search-status-dot');
        const statusText = document.getElementById('search-status-text');

        if (dot) dot.className = `api-status-dot ${ok ? 'online' : (isWarming ? 'warming' : 'offline')}`;
        if (searchDot) searchDot.style.background = ok ? '#22c55e' : (isWarming ? '#eab308' : '#ef4444');
        if (statusText) statusText.textContent = ok ? '服務正常' : (isWarming ? '後端暖機中...' : '後端連接失敗');
    }

    setFileName(name) {
        const el = document.getElementById('video-title');
        if (el) el.textContent = name;
    }

    setModelCacheStatus(fromCache, mb) {
        const el = document.getElementById('model-cache-status');
        if (el) {
            el.textContent = fromCache ? `⚡ 已就緒 (${Math.round(mb)}MB)` : `📥 已下載 (${Math.round(mb)}MB)`;
            el.style.display = 'block';
        }
    }

    showEnvBadges(env) {
        const container = document.getElementById('env-badges');
        if (!container) return;
        container.innerHTML = `<span class="badge ${env.hasWebGPU ? 'badge-gpu' : 'badge-wasm'}">${env.hasWebGPU ? 'WebGPU ⚡' : 'WASM CPU'}</span>`;
    }

    async setResults(results, fileName, metadata = null) {
        this.setState(UIState.DONE);
        const vBuffer = await this._blobToAudioBuffer(results.vocalsBlob);
        const aBuffer = await this._blobToAudioBuffer(results.accompanimentBlob);

        let source = metadata?.id || null;
        if (!source && this._selectedFile && (this._selectedFile.type.includes('video') || this._selectedFile.name.match(/\.(mp4|mov|m4v)$/i))) {
            source = URL.createObjectURL(this._selectedFile);
        }

        await ktv.load(vBuffer, aBuffer, source);
        this.setStatus('🎉 準備完成，開始熱唱！');

        // 重要：分析完成後關閉黑畫面覆蓋層
        if (this.$videoOverlay) {
            this.$videoOverlay.classList.remove('active');
            this.$videoOverlay.style.display = 'none';
        }
    }

    showError(msg) {
        this.setStatus(`❌ ${msg}`);
        this.setState(UIState.ERROR);
        setTimeout(() => this.setState(UIState.IDLE), 5000);
    }

    async _blobToAudioBuffer(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        return await ktv.ctx.decodeAudioData(arrayBuffer);
    }

    renderHistory() {
        const history = getHistory();
        const container = document.getElementById('history-list');
        if (!container) return;
        container.innerHTML = history.length ? history.map(item => `
            <div class="history-item" onclick="window.ui.emit('history-item-selected', ${JSON.stringify(item).replace(/"/g, '&quot;')})">
                <div style="font-weight:700;">${item.title}</div>
                <div style="font-size:0.75rem; opacity:0.6;">${item.time}</div>
            </div>
        `).join('') : '<div style="opacity:0.5; padding:20px; text-align:center;">暫無歷史紀錄</div>';
    }

    _initEngineSettings() {
        const config = EngineConfig.load();
        const inputs = {
            'cookie-input': config.cookies,
            'cloud-backend-input': config.cloud_backend,
            'backend-input': config.backend
        };
        Object.entries(inputs).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val || '';
        });
    }

    reset() {
        ktv.destroy();
        location.reload();
    }
}
