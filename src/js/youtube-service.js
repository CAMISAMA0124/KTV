/**
 * src/js/youtube-service.js
 * YouTube 服務模組 — 整合搜尋與音訊擷取 (Hyper Automated v5)
 */

export const EngineConfig = {
    load() {
        try {
            const saved = localStorage.getItem('ktv_engine_config');
            return saved ? JSON.parse(saved) : { cookies: '', proxy: '', backend: '' };
        } catch { return { cookies: '', proxy: '', backend: '' }; }
    },
    save(config) {
        localStorage.setItem('ktv_engine_config', JSON.stringify(config));
    },
    clear() {
        localStorage.removeItem('ktv_engine_config');
    },
    getDynamicAPIs() {
        const config = this.load();
        const apis = [];
        if (config.backend) apis.push(config.backend);
        return [...apis, ...SAME_ORIGIN_API, ...EXTERNAL_APIS];
    }
};

const SAME_ORIGIN_API = [''];
const EXTERNAL_APIS = [
    'https://wicked-maps-return.loca.lt',
    import.meta.env.VITE_API_BASE,
    'https://ktv-ey9t.onrender.com',
].filter(Boolean).map(url => url.replace(/\/$/, '').replace(/\/api$/, ''));

function getEffectiveEndpoints() {
    const config = EngineConfig.load();
    const list = config.backend ? [config.backend] : [];
    const combined = [...list, ...SAME_ORIGIN_API, ...EXTERNAL_APIS];
    return [...new Set(combined)];
}

async function fetchWithFailover(path, options = {}) {
    let lastError = null;
    const endpoints = getEffectiveEndpoints();
    const config = EngineConfig.load();

    for (const base of endpoints) {
        try {
            let url;
            if (base === '') {
                url = `/api${path}`;
            } else {
                const cleanBase = base.replace(/\/$/, '').replace(/\/api$/, '');
                url = `${cleanBase}/api${path}`;
            }
            console.log(`[Failover] Trying: ${url}`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 12000);

            const res = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Bypass-Tunnel-Reminder': 'true',
                    'X-Youtube-Cookies': config.cookies || '',
                },
                signal: options.signal || controller.signal
            });
            clearTimeout(timeoutId);

            if (!res.ok) {
                if (res.status === 404 || res.status === 429 || res.status >= 500) {
                    const errBody = await res.json().catch(() => ({}));
                    throw new Error(`端點異常 (HTTP ${res.status}): ${errBody.error || '無法連線'}`);
                }
            }
            return res;
        } catch (e) {
            console.warn(`[Failover] ${base || 'Vercel'} failed: ${e.message}`);
            lastError = e;
        }
    }
    throw new Error(`所有後端服務皆不可用。\n${lastError ? lastError.message : '請檢查網路。'}`);
}

export async function searchYouTube(query) {
    const res = await fetchWithFailover('/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '搜尋失敗');
    return data.results;
}

export async function fetchVideoInfo(url) {
    const res = await fetchWithFailover('/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '無法取得影片資訊');
    return data.info;
}

/**
 * 超強健自動化擷取引擎 (v5 - Hyper Automated)
 * 策略：多重 Cobalt 實例 + 多重 CORS 代理 + 瀏覽器端背景下載
 */
export async function extractFromURL(url, onProgress, signal) {
    onProgress?.(5);

    const COBALT_INSTANCES = [
        'https://api.cobalt.tools/api/json',
        'https://co.wuk.sh/api/json',
        'https://cobalt.hypertube.xyz/api/json',
        'https://api.dr0.ch/api/json',
        'https://cobalt.unlocked.link/api/json'
    ];

    const PROXIES = [
        (api) => `https://corsproxy.io/?${encodeURIComponent(api)}`,
        (api) => `https://api.allorigins.win/raw?url=${encodeURIComponent(api)}`,
    ];

    let lastError = null;

    for (const api of COBALT_INSTANCES) {
        const tryFetch = async (targetUrl) => {
            console.log(`[Extract] Trying: ${targetUrl}`);
            const res = await fetch(targetUrl, {
                method: 'POST',
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
                body: JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true, vQuality: '720' }),
                signal: AbortSignal.timeout(8000)
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        };

        try {
            let data;
            try {
                data = await tryFetch(api);
            } catch (e) {
                console.warn(`[Extract] Direct ${api} failed, trying proxy...`);
                data = await tryFetch(PROXIES[0](api));
            }

            if (data && data.url) {
                console.log('[Extract] Success! Stream found, starting download...');
                onProgress?.(30);

                try {
                    const streamRes = await fetch(data.url, { signal });
                    if (streamRes.ok) return await _readStreamToFile(streamRes, 'audio.mp3', onProgress);
                    throw new Error('Stream response not ok');
                } catch (err) {
                    console.warn('[Extract] Direct stream fetch failed, trying AllOrigins...');
                    const proxiedStreamRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(data.url)}`, { signal });
                    if (proxiedStreamRes.ok) return await _readStreamToFile(proxiedStreamRes, 'audio.mp3', onProgress);
                    throw err;
                }
            }
        } catch (e) {
            lastError = e;
            console.warn(`[Extract] Instance ${api} failed: ${e.message}`);
        }
    }

    // 備援：後端代理
    try {
        console.log('[Extract] Backend proxy as last resort...');
        onProgress?.(25);
        const backendRes = await fetchWithFailover('/proxy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url }),
            signal
        });
        if (backendRes.ok) {
            const data = await backendRes.json();
            if (data.url) {
                const streamRes = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(data.url)}`, { signal });
                return await _readStreamToFile(streamRes, 'audio.mp3', onProgress);
            }
        }
    } catch (e) {
        console.error('[Extract] All attempts failed.');
    }

    throw new Error('自動化下載目前遇到頻繁阻擋，請稍後再試或使用「本地分析」功能。');
}

async function _readStreamToFile(response, defaultName, onProgress) {
    const contentLength = +response.headers.get('Content-Length');
    const reader = response.body.getReader();
    let receivedLength = 0;
    const chunks = [];

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        receivedLength += value.length;
        if (contentLength) {
            const pct = 10 + (receivedLength / contentLength) * 85;
            onProgress?.(pct);
        }
    }

    onProgress?.(100);
    const buffer = new Uint8Array(receivedLength);
    let position = 0;
    for (const chunk of chunks) {
        buffer.set(chunk, position);
        position += chunk.length;
    }

    const titleHeader = response.headers.get('X-Video-Title');
    const title = titleHeader ? decodeURIComponent(titleHeader) : 'audio';
    return new File([buffer], `${title}.${defaultName.split('.').pop()}`, { type: 'audio/mpeg' });
}

export async function checkAPIHealth() {
    try {
        const endpoints = getEffectiveEndpoints();
        for (const base of endpoints) {
            try {
                let url;
                if (base === '') {
                    url = '/api/health';
                } else {
                    url = `${base.replace(/\/$/, '').replace(/\/api$/, '')}/api/health`;
                }
                const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
                const data = await res.json();
                if (data.ok || data.status === 'ok') return { ok: true, ready: true };
            } catch { continue; }
        }
        return { ok: false, ready: false };
    } catch { return { ok: false, ready: false }; }
}

export function isYouTubeURL(str) {
    try {
        const u = new URL(str);
        return /youtube\.com|youtu\.be|music\.youtube\.com/.test(u.hostname);
    } catch { return false; }
}
