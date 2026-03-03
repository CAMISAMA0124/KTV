/**
 * ktv-player.js
 * 核心播放邏輯：YouTube 影片或本地影片與雙音軌同步
 */

import { Jungle } from './jungle.js';

class KTVPlayer {
    constructor() {
        this.ctx = null;
        this.ytPlayer = null;
        this.isReady = false;

        // 音訊節點
        this.accompanimentNode = null;
        this.vocalsNode = null;
        this.accompanimentGain = null;
        this.vocalsGain = null;

        // 分離後的音訊緩衝
        this.vocalsBuffer = null;
        this.accompanimentBuffer = null;

        // 狀態
        this.isGuideMode = true;
        this.currentPitch = 0;
        this.syncInterval = null;
        this.isLocalOnly = false;
        this.localVideo = null;
        this.isPlaying = false;
        this.startTimeOffset = 0;
    }

    initAudioChain() {
        if (!this.ctx) {
            console.log('[KTV] Initializing AudioContext');
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();

        // 每次重新連結節點以確保狀態乾淨
        this.accompanimentGain = this.ctx.createGain();
        this.vocalsGain = this.ctx.createGain();
        this.accompanimentGain.connect(this.ctx.destination);
        this.vocalsGain.connect(this.ctx.destination);
    }

    async load(vocals, accompaniment, source = null) {
        this.destroy(); // 清除舊狀態
        this.initAudioChain();

        this.vocalsBuffer = vocals;
        this.accompanimentBuffer = accompaniment;
        this.vocalPitchShift = new Jungle(this.ctx);
        this.accompPitchShift = new Jungle(this.ctx);
        this.vocalPitchShift.output.connect(this.vocalsGain);
        this.accompPitchShift.output.connect(this.accompanimentGain);

        // ✅ 重要：初始化音調偏移為 0（原調）
        // 先前的 Bug 是 Jungle 預設會帶有微小降調，導致用戶感覺要 +1 才是原調
        this.setPitch(this.currentPitch);

        const container = document.getElementById('video-container');
        if (container) {
            container.innerHTML = '';
            container.style.width = '100%';
            container.style.height = '100%';
            container.style.background = '#000';
        }

        // 核心：判斷是 YouTube 還是本地影片
        const isYTId = typeof source === 'string' && source.length === 11 && !source.includes(':') && !source.includes('/');
        const isYTUrl = typeof source === 'string' && source.startsWith('http') && (source.includes('youtube.com') || source.includes('youtu.be'));

        if (isYTId || isYTUrl) {
            const videoId = isYTId ? source : (new URL(source).searchParams.get('v') || source);
            this.isLocalOnly = false;
            await this.initYTPlayer(videoId);
        } else if (source && (source.startsWith('blob:') || source.startsWith('data:'))) {
            // 本地影片模式
            this.isLocalOnly = true;
            await this.initLocalVideo(source, container);
        } else {
            // 純音訊模式
            this.isLocalOnly = true;
            this.renderAudioUI(container);
        }

        // ✅ 無論什麼模式，載入完成後都要隱藏黑畫面覆蓋層
        const overlay = document.getElementById('video-overlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.classList.remove('active');
        }

        this.isReady = true;
    }

    async initLocalVideo(url, container) {
        const video = document.createElement('video');
        video.src = url;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.borderRadius = '12px';
        video.muted = true;
        video.playsInline = true;
        video.controls = false;
        container.appendChild(video);
        this.localVideo = video;

        video.onplay = () => {
            this.isPlaying = true;
            this.startSync();
        };
        video.onpause = () => {
            this.isPlaying = false;
            this.stopSync();
        };
        video.onseeking = () => this.playAudioFrom(video.currentTime);
        video.onclick = () => video.paused ? video.play() : video.pause();

        // 自動播放本地影片
        try { await video.play(); } catch (e) { console.warn('Autoplay blocked'); }
    }

    renderAudioUI(container) {
        container.innerHTML = `
            <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:linear-gradient(135deg, #1a1a2e, #16213e); color:#fff; border-radius:12px;">
                <div class="eq" style="display:flex; gap:6px; height:40px; align-items:flex-end; margin-bottom:30px;">
                    <style> 
                        .bar { width:6px; background:var(--accent); animation: h 0.8s infinite ease-in-out; border-radius:3px; } 
                        @keyframes h { 0%, 100% {height:15px} 50% {height:40px} } 
                    </style>
                    <div class="bar"></div><div class="bar" style="animation-delay:0.1s"></div><div class="bar" style="animation-delay:0.2s"></div>
                    <div class="bar" style="animation-delay:0.3s"></div><div class="bar" style="animation-delay:0.4s"></div>
                </div>
                <button id="audio-play-btn" style="width:140px; height:44px; border-radius:22px; border:none; background:var(--accent); color:#fff; font-weight:700; font-size:1rem; cursor:pointer; box-shadow:0 10px 20px rgba(0,0,0,0.3);">▶ 點擊播放</button>
            </div>
        `;
        const btn = container.querySelector('#audio-play-btn');
        btn.onclick = () => {
            if (this.isPlaying) {
                this.stopLocal();
                btn.textContent = '▶ 點擊播放';
            } else {
                this.startLocal();
                btn.textContent = '⏸ 暫停';
            }
        };
    }

    startLocal() { this.isPlaying = true; this.startSync(); }
    stopLocal() { this.isPlaying = false; this.stopSync(); }

    initYTPlayer(videoId) {
        console.log('[KTV] Initializing YouTube Player for ID:', videoId);
        return new Promise((resolve) => {
            const setupPlayer = () => {
                try {
                    if (this.ytPlayer) this.ytPlayer.destroy();
                    this.ytPlayer = new YT.Player('video-container', {
                        height: '100%', width: '100%', videoId: videoId,
                        playerVars: {
                            'autoplay': 1, 'mute': 1, 'controls': 1,
                            'playsinline': 1, 'rel': 0, 'modestbranding': 1,
                            'enablejsapi': 1, 'origin': window.location.origin
                        },
                        events: {
                            'onReady': () => {
                                console.log('[KTV] YT Player Ready');
                                resolve();
                            },
                            'onStateChange': (e) => {
                                if (e.data === YT.PlayerState.PLAYING) this.startSync();
                                else if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) this.stopSync();
                            },
                            'onError': (e) => console.error('[KTV] YT Player Error:', e.data)
                        }
                    });
                } catch (err) {
                    console.error('[KTV] YT Setup Error:', err);
                    resolve();
                }
            };

            if (window.YT && window.YT.Player) {
                setupPlayer();
            } else {
                console.log('[KTV] Loading YT IFrame API...');
                if (!document.getElementById('yt-iframe-api')) {
                    const tag = document.createElement('script');
                    tag.id = 'yt-iframe-api';
                    tag.src = "https://www.youtube.com/iframe_api";
                    document.head.appendChild(tag);
                }

                // 註冊全域回呼，並加上逾時保護
                const timeout = setTimeout(() => {
                    if (!this.ytPlayer) {
                        console.warn('[KTV] YouTube API load timeout, trying manual setup...');
                        if (window.YT && window.YT.Player) setupPlayer();
                    }
                }, 5000);

                const oldOnReady = window.onYouTubeIframeAPIReady;
                window.onYouTubeIframeAPIReady = () => {
                    console.log('[KTV] YT IFrame API Ready via Callback');
                    if (oldOnReady) oldOnReady();
                    clearTimeout(timeout);
                    setupPlayer();
                };
            }
        });
    }

    startSync() {
        if (!this.ctx) return;
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const getTime = () => this.isLocalOnly ? (this.localVideo?.currentTime || 0) : (this.ytPlayer?.getCurrentTime?.() || 0);

        this.playAudioFrom(getTime());
        clearInterval(this.syncInterval);
        this.syncInterval = setInterval(() => {
            const yt = getTime();
            const audio = this.ctx.currentTime - this.startTimeOffset;
            if (Math.abs(yt - audio) > 0.15) {
                this.playAudioFrom(yt);
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

    playAudioFrom(time) {
        if (!this.ctx || !this.vocalsBuffer) return;
        this.vocalsNode?.stop();
        this.accompanimentNode?.stop();

        this.vocalsNode = this.ctx.createBufferSource();
        this.accompanimentNode = this.ctx.createBufferSource();
        this.vocalsNode.buffer = this.vocalsBuffer;
        this.accompanimentNode.buffer = this.accompanimentBuffer;

        this.vocalsNode.connect(this.vocalPitchShift.input);
        this.accompanimentNode.connect(this.accompPitchShift.input);

        this.startTimeOffset = this.ctx.currentTime - time;
        this.vocalsNode.start(0, time);
        this.accompanimentNode.start(0, time);
        this.updateGuideVocal();
    }

    toggleGuide(isOn) { this.isGuideMode = isOn; this.updateGuideVocal(); }
    updateGuideVocal() {
        if (!this.vocalsGain) return;
        const gain = this.isGuideMode ? 1.0 : 0.0;
        this.vocalsGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.1);
    }

    replay() {
        console.log('[KTV] Replay requested');
        if (this.isLocalOnly && this.localVideo) {
            this.localVideo.currentTime = 0;
            this.localVideo.play();
        } else if (this.ytPlayer && this.ytPlayer.seekTo) {
            this.ytPlayer.seekTo(0);
            this.ytPlayer.playVideo();
        }
        this.playAudioFrom(0);
    }

    setPitch(key) {
        this.currentPitch = key;
        const mult = key / 12;
        this.vocalPitchShift?.setPitchOffset(mult);
        this.accompPitchShift?.setPitchOffset(mult);
    }

    destroy() {
        this.stopSync();
        if (this.ctx) {
            try { this.ctx.close(); } catch (e) { }
        }
        this.ctx = null;
        this.ytPlayer = null;
        this.localVideo = null;
        this.isPlaying = false;
    }
}

export const ktv = new KTVPlayer();
