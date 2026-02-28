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
        this._urlDebounceTimer = null;
        this._apiAvailable = false;
        this._selectedVideo = null;
        this._currentPitch = 0;

        // DOM refs — Search
        this.$urlInput = document.getElementById('url-input');
        this.$urlClearBtn = document.getElementById('url-clear-btn');
        this.$extractBtn = document.getElementById('extract-btn');
        this.$videoPreview = document.getElementById('video-preview');
        this.$videoThumb = document.getElementById('video-thumb');
        this.$videoTitle = document.getElementById('video-title');
        this.$videoUploader = document.getElementById('video-uploader');
        this.$videoDuration = document.getElementById('video-duration');
        this.$searchResults = document.getElementById('search-results');
        this.$searchForm = document.getElementById('search-form');
        this.$searchStatusText = document.getElementById('search-status-text');
        this.$apiStatusDot = document.getElementById('api-status-dot');
        this.$searchStatusDot = document.getElementById('search-status-dot');

        // DOM refs — History
        this.$historySection = document.getElementById('history-section');
        this.$historyList = document.getElementById('history-list');

        // DOM refs — shared
        this.$statusText = document.getElementById('status-text');
        this.$progressWrap = document.getElementById('progress-wrap');
        this.$progressFill = document.getElementById('progress-bar') || document.getElementById('progress-fill');
        this.$progressPct = document.getElementById('progress-pct');
        this.$etaText = document.getElementById('eta-text');
        this.$envBadges = document.getElementById('env-badges');
        this.$envWarnings = document.getElementById('env-warnings');
        this.$modelStatus = document.getElementById('model-cache-status');
        this.$cancelBtn = document.getElementById('cancel-btn');
        this.$waveform = document.getElementById('vocal-wave') || document.getElementById('waveform');

        // DOM refs — result
        this.$resultPanel = document.getElementById('result-panel');
        this.$videoOverlay = document.getElementById('video-overlay');
        this.$resetBtn = document.getElementById('reset-btn');
        this.$saveBtn = document.getElementById('save-btn');

        this.$guideToggle = document.getElementById('guide-toggle');
        this.$pitchDown = document.getElementById('pitch-down');
        this.$pitchUp = document.getElementById('pitch-up');
        this.$pitchVal = document.getElementById('pitch-val');

        // DOM refs — Engine Drawer
        this.$engineBtn = document.getElementById('engine-btn');
        this.$engineDrawer = document.getElementById('engine-drawer');
        this.$drawerOverlay = document.getElementById('drawer-overlay');
        this.$closeDrawer = document.getElementById('close-drawer');
        this.$saveSettings = document.getElementById('save-settings');
        this.$clearCacheBtn = document.getElementById('clear-cache-btn');
        this.$toggleManual = document.getElementById('toggle-manual');
        this.$manualArea = document.getElementById('manual-settings');
        this.$cookieInput = document.getElementById('cookie-input');
        this.$proxyInput = document.getElementById('proxy-input');
        this.$backendInput = document.getElementById('backend-input');

        this._bindEvents();
        this.renderHistory();
        this._initEngineSettings();
    }

    // ── Event emitter ────────────────────────────────────────
    on(event, fn) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(fn);
    }
    emit(event, ...args) {
        (this._listeners[event] || []).forEach(fn => fn(...args));
    }

    // ── Bind events ──────────────────────────────────────────
    _bindEvents() {
        // Drag & Drop
        this._initDragAndDrop();

        // KTV Controls
        this.$guideToggle?.addEventListener('click', () => {
            if ('vibrate' in navigator) navigator.vibrate(5);
            const isActive = this.$guideToggle.classList.contains('active');
            const newState = !isActive;
            this.$guideToggle.classList.toggle('active', newState);
            this.$guideToggle.setAttribute('aria-pressed', newState);
            this.$guideToggle.querySelector('.ktv-label').textContent = newState ? '導唱 On' : '導唱 Off';
            ktv.toggleGuide(newState);
        });

        this.$pitchDown?.addEventListener('click', () => {
            if ('vibrate' in navigator) navigator.vibrate(5);
            this._currentPitch--;
            this._updatePitch();
        });

        this.$pitchUp?.addEventListener('click', () => {
            if ('vibrate' in navigator) navigator.vibrate(5);
            this._currentPitch++;
            this._updatePitch();
        });


        // Engine Drawer UI
        this.$engineBtn?.addEventListener('click', () => this._toggleEngineDrawer(true));
        this.$closeDrawer?.addEventListener('click', () => this._toggleEngineDrawer(false));
        this.$drawerOverlay?.addEventListener('click', () => this._toggleEngineDrawer(false));

        this.$toggleManual?.addEventListener('click', () => {
            const isHidden = this.$manualArea.style.display === 'none';
            this.$manualArea.style.display = isHidden ? 'block' : 'none';
            this.$toggleManual.textContent = isHidden ? '隱藏專家設定' : '顯示進階專家設定 (Cookies)';
        });

        this.$saveSettings?.addEventListener('click', () => {
            const config = {
                cookies: this.$cookieInput?.value.trim() || '',
                proxy: '', // Automated
                backend: '' // Automated
            };
            EngineConfig.save(config);
            this._toggleEngineDrawer(false);
            this._updateEngineStatus();
            alert('🚀 引擎連線已優化！重啟中...');
            window.location.reload();
        });

        this.$clearCacheBtn?.addEventListener('click', async () => {
            if (confirm('⚠️ 確定要清除手機內所有暫存的歌曲與歷史紀錄嗎？')) {
                await clearAllData();
                alert('🧹 暫存已清空！');
                location.reload();
            }
        });

        this.$saveBtn?.addEventListener('click', () => {
            if (!this._currentVocalsURL) return;
            const a1 = document.createElement('a');
            a1.href = this._currentVocalsURL;
            a1.download = `${this._currentBaseName}_vocals.wav`;
            a1.click();

            setTimeout(() => {
                const a2 = document.createElement('a');
                a2.href = this._currentAccompURL;
                a2.download = `${this._currentBaseName}_instrumental.wav`;
                a2.click();
            }, 300);
        });

        // Local Upload
        const fileInput = document.getElementById('local-file-input');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                this._selectedFile = file; // Store the selected file
                this._showModeSelection();  // Show the AI/Quick mode prompt
                this.setStatus(`✅ 已選擇音檔: ${file.name}，請選擇要處理的模式`);
            });
        }

        // URL / Search input
        this.$urlInput?.addEventListener('input', () => {
            const val = this.$urlInput.value.trim();
            this.$urlClearBtn.style.display = val ? 'block' : 'none';
            if (!val) this._resetURLPanel();
        });

        this.$searchForm?.addEventListener('submit', (e) => {
            e.preventDefault();
            const val = this.$urlInput.value.trim();
            if (!val) return;

            clearTimeout(this._urlDebounceTimer);
            this.$urlInput.placeholder = '搜尋中...';

            if (isYouTubeURL(val)) {
                this._handleDirectURL(val);
            } else {
                this.emit('url-search', val);
            }
        });

        this.$urlClearBtn?.addEventListener('click', () => {
            this.$urlInput.value = '';
            this.$urlClearBtn.style.display = 'none';
            this._resetURLPanel();
        });

        this.$extractBtn?.addEventListener('click', () => {
            if (this._selectedVideo && this.state === UIState.IDLE) {
                if (this._selectedFile) {
                    // 已有本地音檔，直接顯示模式選擇
                    this._showModeSelection();
                } else {
                    // 還沒下載，顯示下載指引
                    this._showDownloadGuide(this._selectedVideo.url, this._selectedVideo.title);
                }
            }
        });

        // Mode cards
        document.getElementById('mode-quick')?.addEventListener('click', () => {
            this.emit('mode-selected', 'quick', this._selectedFile, this._selectedVideo);
        });
        document.getElementById('mode-ai')?.addEventListener('click', () => {
            this.emit('mode-selected', 'ai', this._selectedFile, this._selectedVideo);
        });

        this.$resetBtn?.addEventListener('click', () => this.reset());
        this.$cancelBtn?.addEventListener('click', () => this.emit('cancel'));
    }

    _updatePitch() {
        this._currentPitch = Math.max(-5, Math.min(5, this._currentPitch));
        const val = this._currentPitch;
        this.$pitchVal.textContent = val === 0 ? '原調' : (val > 0 ? `+${val}` : `${val}`);
        this.$pitchDown.disabled = this._currentPitch <= -5;
        this.$pitchUp.disabled = this._currentPitch >= 5;
        ktv.setPitch(this._currentPitch);
    }

    async _handleDirectURL(url) {
        this.$urlInput.placeholder = '貼上網址或搜尋歌曲...';
        this._resetURLPanel();
        this.setStatus('🔍 讀取網址資訊...');
        try {
            const info = await fetchVideoInfo(url);
            this._selectVideo({
                id: info.id || url.match(/(?:v=|\/embed\/|\/1\/|\/v\/|https:\/\/youtu\.be\/)([^"&?\/\s]{11})/)?.[1],
                url: url,
                title: info.title,
                uploader: info.uploader,
                thumbnail: info.thumbnail,
                duration: info.duration
            });
            this.setStatus('✅ 已讀取連結，點擊按鈕開始分析');
        } catch (e) {
            this.setStatus('❌ 無法讀取連結');
        }
    }

    showSearchResults(results) {
        this.$urlInput.placeholder = '貼上網址或搜尋歌曲...';
        this._resetURLPanel();
        if (!results || results.length === 0) {
            this.$searchResults.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-3); font-size: 0.85rem;">☹️ 找不到相關歌曲，請嘗試縮減關鍵字</div>';
            this.$searchResults.style.display = 'block';
            return;
        }

        this.$searchResults.innerHTML = results.map(video => `
            <div class="search-item" data-id="${video.id}" style="display:flex; align-items:center; gap:14px; padding:12px; border-radius:20px; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.05); margin-bottom:10px; cursor:pointer; transition:0.3s cubic-bezier(0.23, 1, 0.32, 1);">
                <img class="search-thumb" src="${video.thumbnail}" style="width:100px; height:56px; border-radius:12px; object-fit:cover; flex-shrink:0;">
                <div class="search-meta" style="flex: 1; min-width: 0;">
                    <div class="search-title" style="font-weight:700; font-size:0.92rem; margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${video.title}</div>
                    <div class="search-sub" style="font-size:0.75rem; color:var(--text-3); display:flex; gap:10px;">
                        <span>👤 ${video.uploader}</span>
                        <span>⏱️ ${this._formatSeconds(video.duration)}</span>
                    </div>
                </div>
                <button class="inline-extract-btn" style="
                    display: flex; align-items: center; justify-content: center; gap: 4px;
                    padding: 10px 14px; border-radius: 14px; border: none;
                    background: linear-gradient(135deg, var(--accent) 0%, var(--accent-blue) 100%);
                    color: #fff; font-weight: 800; font-size: 0.8rem;
                    cursor: pointer; box-shadow: 0 4px 12px rgba(167, 139, 250, 0.2);
                    transition: all 0.2s; white-space: nowrap; flex-shrink: 0;
                " onmouseover="this.style.transform='scale(1.05)'; this.style.boxShadow='0 6px 16px rgba(167, 139, 250, 0.3)'" onmouseout="this.style.transform='scale(1)'">
                    📥 下載導引
                </button>
            </div>
        `).join('');

        this.$searchResults.style.display = 'flex';
        this.$searchResults.style.flexDirection = 'column';


        this.$searchResults.querySelectorAll('.search-item').forEach((item, idx) => {
            const btn = item.querySelector('.inline-extract-btn');

            item.onclick = () => {
                this._selectVideo(results[idx]);

                // Hide the main preview and extract btn because we have the inline one!
                this.$videoPreview.style.display = 'none';
                this.$extractBtn.style.display = 'none';

                // Reset all other items
                this.$searchResults.querySelectorAll('.search-item').forEach(el => {
                    el.classList.remove('selected');
                    const b = el.querySelector('.inline-extract-btn');
                    if (b) b.style.display = 'none';
                });

                // Set this item as selected
                item.classList.add('selected');
                if (btn) {
                    btn.style.display = 'flex';
                    btn.textContent = '🎵 複製網址並下載';
                    btn.disabled = false;
                }
            };

            if (btn) {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(results[idx].url).catch(() => { });
                    this._showDownloadGuide(results[idx].url, results[idx].title);
                };
            }
        });
    }

    _selectVideo(video) {
        this._selectedVideo = video;
        this.$videoThumb.src = video.thumbnail;
        this.$videoTitle.textContent = video.title;
        this.$videoUploader.textContent = `👤 ${video.uploader}`;
        this.$videoDuration.textContent = `⏱️ ${this._formatSeconds(video.duration)}`;
        this.$videoPreview.style.display = 'flex';
        this.$extractBtn.style.display = 'inline-flex';
        this.$extractBtn.textContent = '📥 下載並分析此歌曲';
        this.$extractBtn.disabled = false;
        this.$extractBtn.onclick = () => {
            navigator.clipboard.writeText(video.url).catch(() => { });
            this._showDownloadGuide(video.url, video.title);
        };
        this.emit('video-selected', video);
    }

    _formatSeconds(s) {
        const m = Math.floor(s / 60), sec = String(Math.floor(s % 60)).padStart(2, '0');
        return `${m}:${sec}`;
    }

    _resetURLPanel() {
        this._selectedVideo = null;
        this.$searchResults.style.display = 'none';
        this.$videoPreview.style.display = 'none';
        this.$extractBtn.style.display = 'none';
        document.getElementById('mode-selection').style.display = 'none';
    }

    _showModeSelection() {
        document.getElementById('mode-selection').style.display = 'block';
        this.$extractBtn.style.display = 'none';
        // 顯示提示 hint
        const hint = document.getElementById('mode-file-hint');
        if (hint) {
            hint.style.display = this._selectedFile ? 'block' : 'none';
        }
        window.scrollTo({ top: document.getElementById('mode-selection').offsetTop - 20, behavior: 'smooth' });
    }

    /**
     * 顯示下載指引 Modal — 整合多個下載工具
     */
    _showDownloadGuide(ytUrl, title) {
        // 移除已存在的 modal
        document.getElementById('dl-guide-modal')?.remove();

        const tools = [
            { name: 'cobalt.tools', url: 'https://cobalt.tools/', desc: '無廣告，隱私佳', icon: '🔵' },
            { name: 'yt5s.in', url: 'https://yt5s.in/', desc: '支援 M4A/MP3', icon: '🟢' },
            { name: 'ytmp3.cc', url: 'https://ytmp3.cc/', desc: 'MP3 高品質', icon: '🟡' },
            { name: 'savefrom.net', url: 'https://savefrom.net/', desc: '老牌工具', icon: '🟠' },
        ];

        const modal = document.createElement('div');
        modal.id = 'dl-guide-modal';
        modal.style.cssText = `
            position: fixed; inset: 0; z-index: 9999;
            background: rgba(0,0,0,0.85); backdrop-filter: blur(12px);
            display: flex; align-items: flex-end; justify-content: center;
            padding: 20px;
        `;
        modal.innerHTML = `
            <div style="
                background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                border: 1px solid rgba(167,139,250,0.3);
                border-radius: 28px 28px 20px 20px;
                padding: 28px 24px 32px;
                width: 100%; max-width: 480px;
                box-shadow: 0 -20px 60px rgba(167,139,250,0.2);
            ">
                <div style="text-align:center; margin-bottom: 20px;">
                    <div style="font-size:2rem; margin-bottom:8px;">📥</div>
                    <h3 style="font-size:1.1rem; font-weight:800; margin:0 0 6px;">下載音訊到手機</h3>
                    <p style="font-size:0.8rem; color: rgba(255,255,255,0.5); margin:0;">
                        YouTube 網址已複製到剪貼簿<br>請選擇下載工具，貼上網址並下載 <b>M4A</b> 或 <b>MP3</b> 格式
                    </p>
                </div>
                <div style="display:flex; flex-direction:column; gap:10px; margin-bottom:20px;">
                    ${tools.map(t => `
                        <a href="${t.url}" target="_blank" rel="noopener" style="
                            display:flex; align-items:center; gap:14px;
                            background: rgba(255,255,255,0.06);
                            border: 1px solid rgba(255,255,255,0.1);
                            border-radius: 14px; padding: 14px 18px;
                            text-decoration: none; color: #fff;
                            transition: background 0.2s;
                        " onmouseover="this.style.background='rgba(167,139,250,0.15)'" onmouseout="this.style.background='rgba(255,255,255,0.06)'">
                            <span style="font-size:1.5rem;">${t.icon}</span>
                            <div>
                                <div style="font-weight:700; font-size:0.95rem;">${t.name}</div>
                                <div style="font-size:0.75rem; color:rgba(255,255,255,0.4);">${t.desc}</div>
                            </div>
                            <span style="margin-left:auto; opacity:0.4; font-size:1.1rem;">↗</span>
                        </a>
                    `).join('')}
                </div>
                <div style="
                    background: rgba(167,139,250,0.1);
                    border: 1px solid rgba(167,139,250,0.2);
                    border-radius: 12px; padding: 12px 16px;
                    font-size: 0.78rem; color: rgba(255,255,255,0.5);
                    margin-bottom: 16px; line-height: 1.6;
                ">
                    💡 <b>下載完成後</b>：關閉外部視窗，點選上方<br>
                    <b>📁 本地音檔分析</b> 上傳剛下載的音檔
                </div>
                <button id="dl-guide-close" style="
                    width:100%; padding:14px; border-radius:14px; border:none;
                    background: rgba(255,255,255,0.08); color:#fff;
                    font-size:0.9rem; font-weight:600; cursor:pointer;
                ">✕ 關閉</button>
            </div>
        `;

        document.body.appendChild(modal);
        modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
        document.getElementById('dl-guide-close').addEventListener('click', () => modal.remove());
    }

    setAPIStatus(ok, isWarming = false) {
        this._apiAvailable = ok;

        // Update dots
        if (this.$apiStatusDot) {
            this.$apiStatusDot.classList.remove('online', 'warming', 'offline');
            if (ok) {
                this.$apiStatusDot.classList.add('online');
                this.$apiStatusDot.title = '後端連線正常';
            } else if (isWarming) {
                this.$apiStatusDot.classList.add('warming');
                this.$apiStatusDot.title = '後端暖機中，請稍候...';
            } else {
                this.$apiStatusDot.classList.add('offline');
                this.$apiStatusDot.title = '後端未啟動或連線失敗';
            }
        }

        if (this.$searchStatusDot) {
            this.$searchStatusDot.style.background = ok ? 'var(--green)' : (isWarming ? 'var(--yellow)' : 'var(--red)');
            this.$searchStatusDot.style.boxShadow = `0 0 10px ${ok ? 'var(--green)' : (isWarming ? 'var(--yellow)' : 'var(--red)')}`;
        }

        if (!ok && !isWarming) {
            if (!document.getElementById('api-warning')) {
                const badge = document.createElement('div');
                badge.className = 'warning-item';
                badge.id = 'api-warning';
                badge.textContent = '⚠️ YouTube 後端未啟動，功能受限';
                badge.style.cssText = 'padding: 6px 16px; border-top: 1px solid rgba(255,255,255,0.06); text-align:center; font-size: 0.75rem; color: var(--text-3);';
                this.$panelUrl.appendChild(badge);
            }
        } else {
            document.getElementById('api-warning')?.remove();
        }
    }

    // ── History ──────────────────────────────────────────────
    renderHistory() {
        const history = getHistory();
        if (history.length === 0) {
            this.$historySection.style.display = 'none';
            return;
        }

        this.$historySection.style.display = 'block';
        this.$historyList.innerHTML = history.map(item => `
            <div class="history-card" data-id="${item.id}">
                <img src="${item.thumbnail}" class="history-thumb" alt="">
                <div class="history-title">${item.title}</div>
            </div>
        `).join('');

        this.$historyList.querySelectorAll('.history-card').forEach((card, idx) => {
            card.onclick = () => this.emit('history-item-selected', history[idx]);
        });
    }

    // ── State machine ────────────────────────────────────────
    setState(state) {
        this.state = state;
        document.body.dataset.uiState = state;

        const busy = [UIState.LOADING_MODEL, UIState.PROCESSING].includes(state);
        this.$progressWrap.style.display = busy ? 'block' : 'none';
        this.$cancelBtn.style.display = busy ? 'flex' : 'none';

        // 隱藏所有主要區塊，確保不重複疊加
        const cards = [
            document.querySelector('.input-card'),
            document.getElementById('mode-selection'),
            this.$resultPanel,
            this.$historySection
        ];
        cards.forEach(c => { if (c) c.style.display = 'none'; });

        // 根據狀態渲染 UI
        if (state === UIState.IDLE || state === UIState.ERROR) {
            document.querySelector('.input-card').style.display = 'block';
            this.$historySection.style.display = 'block';
            this.renderHistory();
        } else if (state === UIState.LOADING_MODEL || state === UIState.PROCESSING) {
            this.$waveform.classList.add('active');
        } else if (state === UIState.DONE) {
            this.$resultPanel.style.display = 'flex';
            this.$resultPanel.classList.add('visible');
            this.$resultPanel.setAttribute('aria-hidden', 'false');
            this.$waveform.classList.remove('active');
        }
    }

    setStatus(msg) {
        if (this.$statusText) this.$statusText.textContent = msg;
        if (this.$searchStatusText) this.$searchStatusText.textContent = msg;
    }

    setProgress(pct, eta = null) {
        if (!this.$progressFill) return;
        const c = Math.max(0, Math.min(100, pct));
        this.$progressFill.style.width = `${c}%`;
        if (this.$progressPct) {
            this.$progressPct.textContent = `${Math.round(c)}%`;
        }
        if (eta && this.$etaText) {
            this.$etaText.textContent = `預估剩餘: ${eta}`;
            this.$etaText.style.display = 'block';
        }
    }

    showEnvBadges(env) {
        const badges = [];
        if (env.hasWebGPU) badges.push({ t: 'WebGPU ⚡', c: 'badge-gpu' });
        else badges.push({ t: 'WASM CPU', c: 'badge-wasm' });
        if (env.isIOS) badges.push({ t: `iOS ${env.iOSVersion.major}`, c: 'badge-ios' });
        this.$envBadges.innerHTML = badges.map(b => `<span class="badge ${b.c}">${b.t}</span>`).join('');
    }

    setModelCacheStatus(fromCache, mb) {
        if (!this.$modelStatus) return;
        this.$modelStatus.textContent = fromCache ? `⚡ 快取命中 (${Math.round(mb)} MB)` : `📥 已下載並快取 (${Math.round(mb)} MB)`;
        this.$modelStatus.className = 'model-cache-status ' + (fromCache ? 'cache-hit' : 'cache-miss');
    }

    async setResults(results, originalFileName, metadata = null) {
        const { vocalsURL, accompanimentURL, vocalsBlob, accompanimentBlob } = results;
        const base = originalFileName.replace(/\.[^.]+$/, '');

        this._currentVocalsURL = vocalsURL;
        this._currentAccompURL = accompanimentURL;
        this._currentBaseName = base;

        this.setState(UIState.DONE);
        this.setStatus('🎉 分析完成！');

        if (metadata && metadata.id) {
            // 1. 先讓結果面板可見（YouTube IFrame 需要看得到容器才能初始化）
            this.$resultPanel.style.display = 'flex';
            this.$resultPanel.classList.add('visible');
            this.setStatus('💾 正在存檔...');

            // 2. 存檔
            try {
                await saveStem(metadata.id, 'vocals', vocalsBlob);
                await saveStem(metadata.id, 'accompaniment', accompanimentBlob);
                addToHistory(metadata);
                this.renderHistory();
            } catch (e) {
                console.error('[Persistence] Save failed:', e);
            }

            // 3. 等 DOM 真正渲染出容器後再初始化 YouTube Player
            this.setStatus('📺 載入影片播放器...');
            this.$videoOverlay.classList.add('active');
            await new Promise(r => setTimeout(r, 800));

            try {
                const vBuffer = await this._blobToAudioBuffer(vocalsBlob);
                const aBuffer = await this._blobToAudioBuffer(accompanimentBlob);
                await ktv.load(vBuffer, aBuffer, metadata.id);
                this.setStatus('✅ 準備完成！點擊影片開始熱唱 🎤');
            } catch (err) {
                console.error('[KTV] Load failed:', err);
                this.setStatus('⚠️ 影片播放器啟動失敗，但您仍可下載人聲/伴奏');
            } finally {
                this.$videoOverlay.classList.remove('active');
            }
        } else {
            this.$resultPanel.style.display = 'flex';
            this.$resultPanel.classList.add('visible');

            const videoWrap = this.$resultPanel.querySelector('.video-container-wrap');
            if (videoWrap) videoWrap.style.display = 'none';

            const guideBtn = document.getElementById('guide-toggle');
            if (guideBtn) guideBtn.style.display = 'none';

            const pitchGroup = this.$resultPanel.querySelector('.pitch-group');
            if (pitchGroup) pitchGroup.style.display = 'none';

            this.setStatus('✅ 本地音檔處理完成！可點擊下方按鈕保存音軌。');
        }
    }

    setFileName(name) {
        if (this.$videoTitle) this.$videoTitle.textContent = name;
    }

    showError(msg) {
        this.setState(UIState.ERROR);
        this.setStatus(msg);
        console.error('[UI] Error:', msg);
        // 8 秒後自動恢復，讓用戶有時間閱讀錯誤訊息
        setTimeout(() => {
            if (this.state === UIState.ERROR) {
                this.setState(UIState.IDLE);
                this.setStatus('');
            }
        }, 8000);
    }

    async _blobToAudioBuffer(blob) {
        const arrayBuffer = await blob.arrayBuffer();
        return await ktv.ctx.decodeAudioData(arrayBuffer);
    }

    reset() {
        ktv.destroy(); // 重置播放器
        location.reload(); // 最徹底的重置方式
    }
    // ── Engine Ignition Logic ──────────────────────────────
    _initEngineSettings() {
        const config = EngineConfig.load();
        if (this.$cookieInput) this.$cookieInput.value = config.cookies || '';
        if (this.$proxyInput) this.$proxyInput.value = config.proxy || '';
        if (this.$backendInput) this.$backendInput.value = config.backend || '';
        this._updateEngineStatus();
    }

    _toggleEngineDrawer(open) {
        if (open) {
            this.$engineDrawer?.classList.add('open');
            this.$drawerOverlay?.classList.add('visible');
        } else {
            this.$engineDrawer?.classList.remove('open');
            this.$drawerOverlay?.classList.remove('visible');
        }
    }

    _updateEngineStatus() {
        const config = EngineConfig.load();
        const hasKey = config.cookies;
        if (this.$engineBtn) {
            this.$engineBtn.classList.toggle('active', !!hasKey);
            const label = this.$engineBtn.querySelector('.engine-label');
            if (label) label.textContent = '設定';
        }
    }

    /**
     * 初始化 拖放功能
     */
    _initDragAndDrop() {
        const dropZone = document.body;

        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, e => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        dropZone.addEventListener('dragover', () => {
            document.body.classList.add('drag-over');
        });

        ['dragleave', 'drop'].forEach(evt => {
            dropZone.addEventListener(evt, () => {
                document.body.classList.remove('drag-over');
            });
        });

        dropZone.addEventListener('drop', e => {
            const file = e.dataTransfer.files[0];
            if (file && (file.type.startsWith('audio/') || file.type.startsWith('video/'))) {
                if ('vibrate' in navigator) navigator.vibrate([10, 30, 10]);
                this.emit('file-selected', file);
            } else {
                this.showError('請拖放音訊或影片檔案 (.mp3, .m4a, .wav, .mp4)');
            }
        });
    }

    /**
     * 簡單 PWA 安裝指引 (偵測 iOS/Android)
     */
    _showInstallPrompt() {
        if (window.matchMedia('(display-mode: standalone)').matches) return;

        const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
        if (isIOS) {
            console.log('[PWA] iOS detected, suggesting Add to Home Screen');
            // 可以根據需要顯示一個小提示視窗
        }
    }
}

