/**
 * yt-sync-manager.js
 * 負責 YouTube 影片與本機音軌的同步播放
 */

export class YTSyncManager {
    constructor() {
        this.player = null;
        this.$audio = null; // 本機音軌元素
        this._isSyncing = false;
        this._syncInterval = null;
        this._ktvMode = false;
        this._videoId = null;
    }

    /**
     * 初始化 YouTube 播放器
     */
    async init(containerId, videoId, $audioElement) {
        this._videoId = videoId;
        this.$audio = $audioElement;

        return new Promise((resolve) => {
            if (window.YT && window.YT.Player) {
                this._createPlayer(containerId, videoId, resolve);
            } else {
                window.onYouTubeIframeAPIReady = () => {
                    this._createPlayer(containerId, videoId, resolve);
                };
                // 載入 API 腳本
                if (!document.getElementById('yt-api-script')) {
                    const tag = document.createElement('script');
                    tag.id = 'yt-api-script';
                    tag.src = "https://www.youtube.com/iframe_api";
                    document.head.appendChild(tag);
                }
            }
        });
    }

    _createPlayer(containerId, videoId, callback) {
        this.player = new YT.Player(containerId, {
            height: '100%',
            width: '100%',
            videoId: videoId,
            playerVars: {
                'playsinline': 1,
                'controls': 0, // 隱藏控制項，由我們接手或保持極簡
                'disablekb': 1,
                'fs': 0,
                'modestbranding': 1,
                'rel': 0
            },
            events: {
                'onReady': () => {
                    callback();
                    console.log('[Sync] YT Player Ready');
                },
                'onStateChange': (e) => this._onPlayerStateChange(e)
            }
        });
    }

    setKTVMode(enabled) {
        this._ktvMode = enabled;
        if (enabled) {
            this.player?.mute();
            this.$audio.volume = 1.0;
        } else {
            this.player?.unMute();
            this.$audio.volume = 0; // 或者暫停本機音軌
        }
    }

    _onPlayerStateChange(event) {
        if (!this._ktvMode) return;

        switch (event.data) {
            case YT.PlayerState.PLAYING:
                this.$audio.play();
                this._startSyncLoop();
                break;
            case YT.PlayerState.PAUSED:
            case YT.PlayerState.BUFFERING:
                this.$audio.pause();
                this._stopSyncLoop();
                break;
            case YT.PlayerState.ENDED:
                this.$audio.pause();
                this.$audio.currentTime = 0;
                break;
        }
    }

    _startSyncLoop() {
        this._stopSyncLoop();
        this._syncInterval = setInterval(() => {
            this._sync();
        }, 500);
    }

    _stopSyncLoop() {
        clearInterval(this._syncInterval);
    }

    _sync() {
        if (!this.player || !this.$audio || !this._ktvMode) return;

        const ytTime = this.player.getCurrentTime();
        const audioTime = this.$audio.currentTime;

        // 若秒數差距超過 0.15 秒，強制修正本機音軌位置
        if (Math.abs(ytTime - audioTime) > 0.15) {
            console.log(`[Sync] Correcting drift: ${audioTime.toFixed(2)} -> ${ytTime.toFixed(2)}`);
            this.$audio.currentTime = ytTime;
        }
    }

    destroy() {
        this._stopSyncLoop();
        this.player?.destroy();
        this.player = null;
    }
}
