/**
 * ktv-player.js
 * 核心播放邏輯：YouTube 影片與雙音軌同步
 * 支援：導唱切換、升降 Key (+-5)、音訊同步校正
 */

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
     * @param {AudioBuffer} vocals 
     * @param {AudioBuffer} accompaniment 
     * @param {string} videoId 
     */
    async load(vocals, accompaniment, videoId) {
        if (this.ctx.state === 'suspended') await this.ctx.resume();

        this.vocalsBuffer = vocals;
        this.accompanimentBuffer = accompaniment;

        // 初始化 YouTube Player (如果還沒建立)
        if (!this.ytPlayer) {
            await this.initYTPlayer(videoId);
        } else {
            try {
                this.ytPlayer.loadVideoById(videoId);
            } catch (e) {
                console.warn('[KTV] Re-initializing player...');
                await this.initYTPlayer(videoId);
            }
        }

        this.isReady = true;
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
                            'enablejsapi': 1
                        },
                        events: {
                            'onReady': () => {
                                console.log('[KTV Player] Ready');
                                try {
                                    this.ytPlayer.unMute();
                                    this.ytPlayer.mute();
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

        // 設定升降 Key (Detune: 100 cents = 1 semitone)
        const detuneValue = this.currentPitch * 100;
        this.accompanimentNode.detune.value = detuneValue;
        this.vocalsNode.detune.value = detuneValue;

        this.accompanimentNode.connect(this.accompanimentGain);
        this.vocalsNode.connect(this.vocalsGain);

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
        if (this.vocalsNode && this.accompanimentNode) {
            const detuneValue = this.currentPitch * 100;
            this.vocalsNode.detune.setTargetAtTime(detuneValue, this.ctx.currentTime, 0.1);
            this.accompanimentNode.detune.setTargetAtTime(detuneValue, this.ctx.currentTime, 0.1);
        }
    }

    destroy() {
        this.stopSync();
        this.ctx.close();
    }
}

export const ktv = new KTVPlayer();
