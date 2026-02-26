/**
 * env-check.js
 * 環境偵測：iOS 版本、WebGPU 可用性
 */

export const EnvStatus = {
    WEBGPU: 'webgpu',
    WEBNN: 'webnn',
    WASM: 'wasm',
};

function getiOSVersion() {
    const ua = navigator.userAgent;
    // Match iOS / iPadOS
    const match = ua.match(/(?:iPhone|iPad|iPod).*OS (\d+)[._](\d+)/);
    if (match) {
        return {
            major: parseInt(match[1], 10),
            minor: parseInt(match[2], 10),
            isIOS: true,
        };
    }
    // Mac Catalyst / desktop
    return { major: 0, minor: 0, isIOS: false };
}

function isSafari() {
    const ua = navigator.userAgent;
    return /Safari/.test(ua) && !/Chrome/.test(ua) && !/CriOS/.test(ua) && !/FxiOS/.test(ua);
}

export async function detectEnvironment() {
    const ios = getiOSVersion();
    const hasSafari = isSafari();
    const hasWebGPU = typeof navigator.gpu !== 'undefined';
    const hasWebNN = typeof navigator.ml !== 'undefined';

    let bestBackend = EnvStatus.WASM;
    let warnings = [];
    let info = [];

    // Check WebGPU
    if (hasWebGPU) {
        try {
            const adapter = await navigator.gpu.requestAdapter();
            if (adapter) {
                bestBackend = EnvStatus.WEBGPU;
                info.push('✅ WebGPU 可用 — GPU 加速模式');
            } else {
                warnings.push('⚠️ WebGPU API 存在但無可用 Adapter，降級至 WASM');
            }
        } catch (e) {
            warnings.push(`⚠️ WebGPU 初始化失敗: ${e.message}`);
        }
    } else if (hasWebNN) {
        bestBackend = EnvStatus.WEBNN;
        info.push('✅ WebNN 可用 — Neural Engine 加速模式');
    } else {
        warnings.push('⚠️ 無 GPU 加速，使用 WASM CPU 模式（較慢）');
    }

    // iOS version warning
    if (ios.isIOS) {
        if (ios.major < 16) {
            warnings.push(`❌ iOS ${ios.major} 過舊，建議升級至 iOS 17+ 以獲得最佳效能`);
        } else if (ios.major < 17) {
            warnings.push(`⚠️ iOS ${ios.major} — WebGPU 支援有限，建議升級至 iOS 17+`);
        } else {
            info.push(`✅ iOS ${ios.major}.${ios.minor} — 完整支援`);
        }
    }

    if (ios.isIOS && !hasSafari) {
        warnings.push('⚠️ 偵測到非 Safari 瀏覽器，iOS 上建議使用 Safari 以獲得最佳 WebGPU 效能');
    }

    // Memory estimate
    let estimatedMemory = null;
    if ('deviceMemory' in navigator) {
        estimatedMemory = navigator.deviceMemory;
        if (estimatedMemory < 4) {
            warnings.push(`⚠️ 裝置記憶體約 ${estimatedMemory}GB，建議 4GB 以上以穩定運算`);
        }
    }

    return {
        bestBackend,
        hasWebGPU: bestBackend === EnvStatus.WEBGPU,
        hasWebNN: bestBackend === EnvStatus.WEBNN,
        isIOS: ios.isIOS,
        iOSVersion: ios,
        isSafari: hasSafari,
        estimatedMemory,
        warnings,
        info,
    };
}
