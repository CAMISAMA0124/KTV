/**
 * ktv-player.js
 * 核心播放邏輯：YouTube 影片與雙音軌同步
 * 支援：導唱切換、升降 Key (+-5)、音訊同步校正
 */

import { Jungle } from './jungle.js';

class KTVPlayer {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.ytPlayer = null;
        this.isReady = false;

        // 音訊節點
        this.accompanimentNode = null;
        this.vocalsNode = null;
        this.accompanimentGain = this.ctx.createGain();
        this.vocalsGain = this.ctx.createGain();

        // 分離後的音訊緩衝
        this.vocalsBuffer = null;
        this.accompanimentBuffer = null;

        // 狀態
        this.isGuideMode = true; // 導唱開啟
        this.currentPitch = 0;   // 升降 Key
        this.syncInterval = null;
        this.toneInitialized = false;

        this.initAudioChain();
    }

    initAudioChain() {
        this.accompanimentGain.connect(this.ctx.destination);
        this.vocalsGain.connect(this.ctx.destination);
        this.vocalsGain.gain.value = 1.0;
        this.accompanimentGain.gain.value = 1.0;
    }

    /**
     * 載入分離後的音軌並準備播放
     */
    async load(vocals, accompaniment, videoId = null) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        this.vocalsBuffer = vocals;
        this.accompanimentBuffer = accompaniment;

        this.vocalPitchShift = new Jungle(this.ctx);
        this.accompPitchShift = new Jungle(this.ctx);

        this.vocalPitchShift.output.connect(this.vocalsGain);
        this.accompPitchShift.output.connect(this.accompanimentGain);

        // 如果有 videoId，初始化 YouTube Player
        if (videoId) {
            this.isLocalOnly = false;
            if (!this.ytPlayer) {
                await this.initYTPlayer(videoId);
            } else {
                try {
                    this.ytPlayer.loadVideoById(videoId);
                } catch (e) {
                    console.warn('[KTV] Re-initializing player...');
                    this.ytPlayer = null;
                    await this.initYTPlayer(videoId);
                }
            }
        } else {
            // 本地模式：顯示一個 Premium 的播放狀態卡片
            this.isLocalOnly = true;
            this.ytPlayer = null;
            const container = document.getElementById('video-container');
            if (container) {
                container.innerHTML = `
                    <div class="local-player-ui" style="
                        height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;
                        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
                        color: #fff; padding: 30px; text-align: center; border-radius: 24px; position: relative; overflow: hidden;
                    ">
                        <!-- Background Glow Decoration -->
                        <div style="position: absolute; width: 200px; height: 200px; background: var(--accent); opacity: 0.1; filter: blur(100px); top: -50px; left: -50px;"></div>
                        <div style="position: absolute; width: 150px; height: 150px; background: var(--accent-pink); opacity: 0.1; filter: blur(80px); bottom: -30px; right: -30px;"></div>

                        <div class="playing-equalizer" style="height: 40px; display: flex; align-items: flex-end; gap: 4px; margin-bottom: 25px;">
                            <style>
                                .eq-bar { width: 4px; border-radius: 2px; background: var(--accent); animation: eq 1s ease-in-out infinite; height: 10px; }
                                .eq-bar:nth-child(2) { animation-delay: 0.1s; height: 25px; }
                                .eq-bar:nth-child(3) { animation-delay: 0.2s; height: 15px; }
                                .eq-bar:nth-child(4) { animation-delay: 0.3s; height: 35px; }
                                .eq-bar:nth-child(5) { animation-delay: 0.4s; height: 20px; }
                                @keyframes eq { 0%, 100% { height: 10px; } 50% { height: 35px; } }
                                .paused .eq-bar { animation-play-state: paused; height: 10px !important; }
                            </style>
                            <div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div><div class="eq-bar"></div>
                        </div>

                        <div style="font-size: 1rem; font-weight: 800; letter-spacing: 0.05em; margin-bottom: 8px;">PREMIUM <span class="gradient-text">OFFLINE PLAYER</span></div>
                        <div style="font-size: 0.8rem; opacity: 0.6; margin-bottom: 30px;">本地音檔 · 已完成 AI 分離</div>

                        <div id="local-player-controls" style="display: flex; align-items: center; gap: 20px;">
                            <button id="local-play-btn" style="
                                width: 70px; height: 70px; border-radius: 50%; border: none;
                                background: linear-gradient(135deg, var(--accent) 0%, #818cf8 100%);
                                color: #fff; font-size: 1.5rem; cursor: pointer;
                                display: flex; align-items: center; justify-content: center;
                                transition: 0.3s cubic-bezier(0.23, 1, 0.32, 1);
                                box-shadow: 0 15px 30px rgba(129, 140, 248, 0.4);
                                -webkit-tap-highlight-color: transparent;
                            ">
                                <span id="local-play-icon">▶</span>
                            </button>
                        </div>
                    </div>
                `;
                const playBtn = container.querySelector('#local-play-btn');
                const playIcon = container.querySelector('#local-play-icon');
                const eq = container.querySelector('.playing-equalizer');

                // 初始設為暫停
                eq.classList.add('paused');

                playBtn?.addEventListener('click', () => {
                    if ('vibrate' in navigator) navigator.vibrate(10);
                    if (this.isPlaying) {
                        this.stopLocal();
                        playIcon.textContent = '▶';
                        eq.classList.add('paused');
                        playBtn.style.transform = 'scale(1)';
                    } else {
                        this.startLocal();
                        playIcon.textContent = '⏸';
                        eq.classList.remove('paused');
                        playBtn.style.transform = 'scale(0.92)';
                    }
                });
            }
        }

        this.isReady = true;
    }

    startLocal() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.isPlaying = true;
        this.playAudioFrom(0);
    }

    stopLocal() {
        this.isPlaying = false;
        this.stopSync();
    }

    initYTPlayer(videoId) {
        return new Promise((resolve) => {
            const container = document.getElementById('video-container');
            if (container) container.innerHTML = '';

            const parent = container?.parentElement;
            if (parent) parent.style.display = 'block';

            const createPlayer = () => {
                try {
                    this.ytPlayer = new YT.Player('video-container', {
                        height: '100%',
                        width: '100%',
                        videoId: videoId,
                        host: 'https://www.youtube.com',
                        playerVars: {
                            'autoplay': 1,
                            'mute': 1,
                            'controls': 1,
                            'disablekb': 1,
                            'fs': 1,
                            'rel': 0,
                            'modestbranding': 1,
                            'playsinline': 1,
                            'enablejsapi': 1,
                            'widget_referrer': window.location.origin
                        },
                        events: {
                            'onReady': (event) => {
                                console.log('[KTV Player] Ready');
                                // Try to play/mute to warm up on mobile
                                try {
                                    event.target.mute();
                                    event.target.playVideo();
                                } catch (e) { }
                                resolve();
                            },
                            'onStateChange': (event) => this.handleYTStateChange(event),
                            'onError': (e) => {
                                console.error('[KTV Player] Error:', e.data);
                                // 當顯示「無法播放影片」時，提示使用者
                                const container = document.getElementById('video-container');
                                if (container) {
                                    container.innerHTML = `
                                        <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#000; color:#fff; padding:20px; text-align:center;">
                                            <p style="margin-bottom:10px;">⚠️ 此影片可能因版權限制無法嵌入播放</p>
                                            <a href="https://www.youtube.com/watch?v=${videoId}" target="_blank" style="color:var(--purple); text-decoration:underline;">在 YouTube 上觀看此影片</a>
                                        </div>
                                    `;
                                }
                                resolve();
                            }
                        }
                    });
                } catch (err) {
                    console.error('[KTV Player] Init Failed:', err);
                    resolve();
                }
            };

            const loadScript = () => {
                if (window.YT && YT.Player && YT.loaded) {
                    createPlayer();
                } else {
                    if (!document.getElementById('yt-iframe-api')) {
                        const tag = document.createElement('script');
                        tag.id = 'yt-iframe-api';
                        tag.src = "https://www.youtube.com/iframe_api";
                        const firstScriptTag = document.getElementsByTagName('script')[0];
                        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
                    }
                    const oldOnReady = window.onYouTubeIframeAPIReady;
                    window.onYouTubeIframeAPIReady = () => {
                        if (oldOnReady) oldOnReady();
                        if (!this.ytPlayer) createPlayer();
                        resolve();
                    };
                    let st = 0;
                    const timer = setInterval(() => {
                        if (window.YT && YT.Player && YT.loaded) {
                            clearInterval(timer);
                            if (!this.ytPlayer) createPlayer();
                            resolve();
                        }
                        if (++st > 10) { clearInterval(timer); resolve(); }
                    }, 1000);
                }
            };
            loadScript();
        });
    }

    handleYTStateChange(event) {
        if (event.data === YT.PlayerState.PLAYING) {
            this.startSync();
        } else if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) {
            this.stopSync();
        }
    }

    /**
     * 同步邏輯：確保音軌與影片位置一致
     */
    startSync() {
        if (this.ctx.state === 'suspended') this.ctx.resume();

        this.playAudioFrom(this.ytPlayer.getCurrentTime());

        this.syncInterval = setInterval(() => {
            const ytTime = this.ytPlayer.getCurrentTime();
            const audioTime = this.ctx.currentTime - this.startTimeOffset;

            // 如果誤差超過 0.1 秒，強制重新同步
            if (Math.abs(ytTime - audioTime) > 0.1) {
                console.log('[KTV Sync] 重新對位...');
                this.playAudioFrom(ytTime);
            }
        }, 1000);
    }

    stopSync() {
        clearInterval(this.syncInterval);
        this.vocalsNode?.stop();
        this.accompanimentNode?.stop();
        this.vocalsNode = null;
        this.accompanimentNode = null;
    }

    /**
     * 從指定時間點啟動音軌播放
     */
    playAudioFrom(time) {
        this.stopSyncOnly();

        this.accompanimentNode = this.ctx.createBufferSource();
        this.vocalsNode = this.ctx.createBufferSource();

        this.accompanimentNode.buffer = this.accompanimentBuffer;
        this.vocalsNode.buffer = this.vocalsBuffer;

        // 將音軌導流進去 (保留原始速度)
        this.accompanimentNode.connect(this.accompPitchShift.input);
        this.vocalsNode.connect(this.vocalPitchShift.input);

        this.startTimeOffset = this.ctx.currentTime - time;

        this.vocalsNode.start(0, time);
        this.accompanimentNode.start(0, time);

        // 如果是導唱關閉，則靜音人聲軌
        this.updateGuideVocal();
    }

    stopSyncOnly() {
        this.vocalsNode?.stop();
        this.accompanimentNode?.stop();
    }

    /**
     * 切換導唱 (有無人聲)
     */
    toggleGuide(isOn) {
        this.isGuideMode = isOn;
        this.updateGuideVocal();
    }

    updateGuideVocal() {
        // 使用線性淡入淡出，效果比較自然
        const targetGain = this.isGuideMode ? 1.0 : 0.01; // 留一點點聲音 (導唱效果) 或者全關 (0.0)
        this.vocalsGain.gain.setTargetAtTime(targetGain, this.ctx.currentTime, 0.1);
    }

    /**
     * 升降 Key: +- 5
     */
    setPitch(key) {
        this.currentPitch = Math.max(-5, Math.min(5, key));
        // Tone is 1 octave per 1. Jungle is 1 octave per 1.0 multiplier
        const mult = this.currentPitch / 12;
        if (this.vocalPitchShift && this.accompPitchShift) {
            this.vocalPitchShift.setPitchOffset(mult);
            this.accompPitchShift.setPitchOffset(mult);
        }
    }

    destroy() {
        this.stopSync();
        this.ctx.close();
    }
}

export const ktv = new KTVPlayer();
