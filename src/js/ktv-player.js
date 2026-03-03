/**
 * ktv-player.js
 * 核心播放邏輯：YouTube 影片或本地影片與雙音軌同步
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
        this.isGuideMode = true;
        this.currentPitch = 0;
        this.syncInterval = null;
        this.isLocalOnly = false;
        this.localVideo = null;
        this.isPlaying = false;

        this.initAudioChain();
    }

    initAudioChain() {
        this.accompanimentGain.connect(this.ctx.destination);
        this.vocalsGain.connect(this.ctx.destination);
    }

    async load(vocals, accompaniment, source = null) {
        this.destroy(); // 清除舊狀態
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.initAudioChain();

        this.vocalsBuffer = vocals;
        this.accompanimentBuffer = accompaniment;
        this.vocalPitchShift = new Jungle(this.ctx);
        this.accompPitchShift = new Jungle(this.ctx);
        this.vocalPitchShift.output.connect(this.vocalsGain);
        this.accompPitchShift.output.connect(this.accompanimentGain);

        const container = document.getElementById('video-container');
        if (container) container.innerHTML = '';

        if (!source) {
            // 純音訊模式
            this.isLocalOnly = true;
            this.renderAudioUI(container);
        } else if (source.startsWith('http') && !source.includes('blob:')) {
            // YouTube 模式
            this.isLocalOnly = false;
            await this.initYTPlayer(source);
        } else {
            // 本地影片模式 (Blob URL)
            this.isLocalOnly = true;
            await this.initLocalVideo(source, container);
        }
        this.isReady = true;
    }

    async initLocalVideo(url, container) {
        const video = document.createElement('video');
        video.src = url;
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.borderRadius = '12px';
        video.muted = true; // 關鍵：靜音原片聲音
        video.playsInline = true;
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

        // 點擊影片播放/暫停
        video.onclick = () => video.paused ? video.play() : video.pause();
    }

    renderAudioUI(container) {
        container.innerHTML = `
            <div style="height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; background:#111; color:#fff;">
                <div class="eq" style="display:flex; gap:4px; height:30px; align-items:flex-end; margin-bottom:20px;">
                    <style> .bar { width:4px; background:var(--accent); animation: h 1s infinite; } @keyframes h { 0%, 100% {height:10px} 50% {height:30px} } </style>
                    <div class="bar"></div><div class="bar" style="animation-delay:0.2s"></div><div class="bar" style="animation-delay:0.4s"></div>
                </div>
                <button id="audio-play-btn" style="padding:10px 20px; border-radius:30px; border:none; background:var(--accent); color:#fff; font-weight:700;">▶ 播放音檔</button>
            </div>
        `;
        const btn = container.querySelector('#audio-play-btn');
        btn.onclick = () => {
            if (this.isPlaying) {
                this.stopLocal();
                btn.textContent = '▶ 播放音檔';
            } else {
                this.startLocal();
                btn.textContent = '⏸ 暫停';
            }
        };
    }

    startLocal() { this.isPlaying = true; this.startSync(); }
    stopLocal() { this.isPlaying = false; this.stopSync(); }

    initYTPlayer(videoId) {
        return new Promise((resolve) => {
            this.ytPlayer = new YT.Player('video-container', {
                height: '100%', width: '100%', videoId: videoId,
                playerVars: { 'autoplay': 1, 'mute': 1, 'playsinline': 1 },
                events: {
                    'onReady': () => resolve(),
                    'onStateChange': (e) => {
                        if (e.data === YT.PlayerState.PLAYING) this.startSync();
                        else this.stopSync();
                    }
                }
            });
        });
    }

    startSync() {
        if (this.ctx.state === 'suspended') this.ctx.resume();
        const getTime = () => this.isLocalOnly ? (this.localVideo?.currentTime || 0) : this.ytPlayer.getCurrentTime();

        this.playAudioFrom(getTime());
        this.syncInterval = setInterval(() => {
            const delta = Math.abs(getTime() - (this.ctx.currentTime - this.startTimeOffset));
            if (delta > 0.15) this.playAudioFrom(getTime());
        }, 1000);
    }

    stopSync() {
        clearInterval(this.syncInterval);
        this.vocalsNode?.stop();
        this.accompanimentNode?.stop();
    }

    playAudioFrom(time) {
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
        const gain = this.isGuideMode ? 1.0 : 0.0;
        this.vocalsGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.1);
    }

    setPitch(key) {
        const mult = key / 12;
        this.vocalPitchShift?.setPitchOffset(mult);
        this.accompPitchShift?.setPitchOffset(mult);
    }

    destroy() {
        this.stopSync();
        if (this.ctx) this.ctx.close();
        this.ytPlayer = null;
        this.localVideo = null;
        this.isPlaying = false;
    }
}

export const ktv = new KTVPlayer();
