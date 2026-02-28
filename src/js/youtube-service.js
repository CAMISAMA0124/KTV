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
        (api) => `https://api.allorigins.win/raw?url=${encodeURIComponent(api)}`,
        (api) => `https://corsproxy.io/?${encodeURIComponent(api)}`,
    ];

    let lastError = null;

    for (const api of COBALT_INSTANCES) {
        // 多種請求方式嘗試: POST (Direct), POST (Proxy), GET (Proxy - 某些代理僅支援 GET)
        const tryCall = async (method, targetUrl, isProxy = false) => {
            console.log(`[Extract] Trying ${method} on ${targetUrl}`);
            const options = {
                method: method,
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(9000)
            };

            if (method === 'POST') {
                options.headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify({ url, aFormat: 'mp3', isAudioOnly: true, vQuality: '720' });
            }

            const res = await fetch(targetUrl, options);
            if (!res.ok) throw new Error(`Status ${res.status}`);
            return await res.json();
        };

        try {
            let data;
            // 優先路徑 A: 直接 POST
            try {
                data = await tryCall('POST', api);
            } catch (e) {
                console.warn(`[Extract] Direct POST to ${api} failed: ${e.message}. Trying AllOrigins...`);
                // 優先路徑 B: 透過 AllOrigins (CORS 最寬鬆)
                try {
                    data = await tryCall('POST', PROXIES[0](api), true);
                } catch {
                    console.warn(`[Extract] AllOrigins failed. Trying CorsProxy.io (GET)...`);
                    // 最後手段：某些 Proxy 自帶把 POST 轉成特殊參數的能力，或我們改用支援 GET 的 Instance (不推薦但可行)
                    // 這裡我們先嘗試 GET 看看該 API 是否支援 (部分 Cobalt 實例可能支援 GET /api/json?url=...)
                    const getUrl = `${api}?url=${encodeURIComponent(url)}&isAudioOnly=true`;
                    data = await tryCall('GET', PROXIES[1](getUrl), true);
                }
            }

            if (data && data.url) {
                console.log('[Extract] JSON Success! Fetching stream...');
                onProgress?.(30);

                // 3. 獲取媒體 Blob (防護最嚴密的地方)
                const streamFetch = async (sUrl) => {
                    // 嘗試 A: 直連
                    try {
                        const r = await fetch(sUrl, { signal });
                        if (r.ok) return r;
                    } catch { }
                    // 嘗試 B: AllOrigins Raw
                    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(sUrl)}`;
                    const r2 = await fetch(proxyUrl, { signal });
                    if (r2.ok) return r2;
                    throw new Error('Media Proxy Failed');
                };

                const streamRes = await streamFetch(data.url);
                return await _readStreamToFile(streamRes, 'audio.mp3', onProgress);
            }
        } catch (e) {
            lastError = e;
            console.warn(`[Extract] Instance ${api} cycle failed: ${e.message}`);
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
