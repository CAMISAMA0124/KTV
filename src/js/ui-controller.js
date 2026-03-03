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
        this.renderHistory();
        this._initEngineSettings();
        this._bindDrawerFileButtons();
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
                document.getElementById('engine-drawer').classList.remove('open');
                document.getElementById('drawer-overlay').classList.remove('visible');
                setTimeout(() => this.emit('mode-selected', pendingMode, file, null), 200);
            } else {
                document.getElementById('mode-selection').style.display = 'block';
                this.setStatus(`✅ 已選擇: ${file.name}`);
            }
            isDrawerTrigger = false;
        });

        document.getElementById('drawer-quick-btn')?.addEventListener('click', () => {
            pendingMode = 'quick';
            isDrawerTrigger = true;
            fileInput.click();
        });

        document.getElementById('drawer-ai-btn')?.addEventListener('click', () => {
            pendingMode = 'ai';
            isDrawerTrigger = true;
            fileInput.click();
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
            btn.querySelector('.ktv-label').textContent = isOn ? '導唱 On' : '導唱 Off';
            ktv.toggleGuide(isOn);
        });

        document.getElementById('pitch-up')?.addEventListener('click', () => this._changePitch(1));
        document.getElementById('pitch-down')?.addEventListener('click', () => this._changePitch(-1));

        document.getElementById('search-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const val = this.$urlInput.value.trim();
            if (isYouTubeURL(val)) {
                const info = await fetchVideoInfo(val);
                this._selectVideo(info);
            } else {
                this.emit('url-search', val);
            }
        });

        document.getElementById('engine-btn')?.addEventListener('click', () => {
            document.getElementById('engine-drawer').classList.add('open');
            document.getElementById('drawer-overlay').classList.add('visible');
        });

        document.getElementById('close-drawer')?.addEventListener('click', () => {
            document.getElementById('engine-drawer').classList.remove('open');
            document.getElementById('drawer-overlay').classList.remove('visible');
        });

        document.getElementById('clear-cache-btn')?.addEventListener('click', async () => {
            if (confirm('確定清除暫存？')) { await clearAllData(); location.reload(); }
        });
    }

    _changePitch(dir) {
        this._currentPitch = Math.max(-5, Math.min(5, this._currentPitch + dir));
        document.getElementById('pitch-val').textContent = this._currentPitch === 0 ? '原調' :
            (this._currentPitch > 0 ? `+${this._currentPitch}` : this._currentPitch);
        ktv.setPitch(this._currentPitch);
    }

    showSearchResults(results) {
        this.$searchResults.innerHTML = results.map(v => `
            <div class="search-item" onclick="window.ui._selectVideoById('${v.id}')" style="display:flex; gap:10px; margin-bottom:10px; cursor:pointer; background:rgba(255,255,255,0.05); padding:10px; border-radius:12px;">
                <img src="${v.thumbnail}" style="width:80px; border-radius:8px;">
                <div><div style="font-weight:700; font-size:0.9rem;">${v.title}</div></div>
            </div>
        `).join('');
        this.$searchResults.style.display = 'block';
        window.ui = this; // 暫時暴露
    }

    async _selectVideoById(id) {
        const info = await fetchVideoInfo(`https://www.youtube.com/watch?v=${id}`);
        this._selectVideo(info);
    }

    _selectVideo(video) {
        this._selectedVideo = video;
        document.getElementById('video-preview').style.display = 'flex';
        document.getElementById('video-thumb').src = video.thumbnail;
        document.getElementById('video-title').textContent = video.title;
        document.getElementById('mode-selection').style.display = 'block';
    }

    setState(state) {
        this.state = state;
        document.body.dataset.uiState = state;
        this.$progressWrap.style.display = (state === 'processing' || state === 'loading_model') ? 'block' : 'none';
        if (state === 'done') {
            this.$resultPanel.style.display = 'flex';
            document.querySelector('.input-card').style.display = 'none';
        }
    }

    setStatus(msg) { this.$statusText.textContent = msg; }
    setProgress(pct) { if (this.$progressFill) this.$progressFill.style.width = `${pct}%`; }

    async setResults(results, fileName, metadata = null) {
        this.setState(UIState.DONE);
        const vBuffer = await this._blobToAudioBuffer(results.vocalsBlob);
        const aBuffer = await this._blobToAudioBuffer(results.accompanimentBlob);

        let source = metadata?.id || null;
        if (!source && this._selectedFile && this._selectedFile.type.includes('video')) {
            source = URL.createObjectURL(this._selectedFile);
        }

        await ktv.load(vBuffer, aBuffer, source);
    }

    async _blobToAudioBuffer(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        return await ktv.ctx.decodeAudioData(arrayBuffer);
    }

    renderHistory() { /* logic */ }
    _initEngineSettings() { /* logic */ }
    showEnvBadges() { }
}
