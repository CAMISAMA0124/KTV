/**
 * test_model.mjs
 * Run directly: node test_model.mjs
 * Tests the ONNX model inference to diagnose silent output
 */

import * as ort from 'onnxruntime-node';
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

const MODEL_PATH = './htdemucs_embedded_test.onnx'; // we'll download or locate
const OPFS_WORKAROUND = null;

// The model should be in OPFS. Since we can't access OPFS from Node,
// let's download a small portion to test shapes, OR use the model if user placed it here.
// Check if there's a local copy
const possiblePaths = [
    './htdemucs_embedded.onnx',
    './htdemucs_embedded_test.onnx',
];

let modelBuffer = null;
for (const p of possiblePaths) {
    if (existsSync(p)) {
        console.log(`Found model at ${p}`);
        modelBuffer = await readFile(p);
        break;
    }
}

if (!modelBuffer) {
    console.log('No local model found. Downloading from HuggingFace (this may take a while)...');
    console.log('URL: https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx');

    const fetch = (await import('node:https')).default;
    modelBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const req = fetch.get(
            'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
            { timeout: 30000 },
            (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400) {
                    const redir = res.headers.location;
                    console.log('Redirect to:', redir);
                    // Follow redirect
                    https.get(redir, (res2) => {
                        res2.on('data', chunk => { chunks.push(chunk); process.stdout.write('.'); });
                        res2.on('end', () => { console.log('\nDone'); resolve(Buffer.concat(chunks)); });
                        res2.on('error', reject);
                    });
                } else {
                    res.on('data', chunk => { chunks.push(chunk); process.stdout.write('.'); });
                    res.on('end', () => { console.log('\nDone'); resolve(Buffer.concat(chunks)); });
                    res.on('error', reject);
                }
            }
        );
        req.on('error', reject);
    });
    console.log('Downloaded', modelBuffer.length, 'bytes');
}

console.log('\n=== Creating ONNX Session ===');
const session = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all'
});

console.log('Input names:', session.inputNames);
console.log('Output names:', session.outputNames);

// Log full input/output metadata
for (const name of session.inputNames) {
    const m = session.inputMetadata?.[name] || {};
    console.log(`  Input "${name}":`, JSON.stringify(m));
}

const N = 343980; // fixed chunk size

console.log('\n=== Test 1: Sine wave audio with zero x ===');
const audioData = new Float32Array(2 * N);
for (let i = 0; i < N; i++) {
    const v = 0.3 * Math.sin(2 * Math.PI * 440 * i / 44100);
    audioData[i] = v;
    audioData[N + i] = v;
}

const audioTensor = new ort.Tensor('float32', audioData, [1, 2, N]);
const xTensor = new ort.Tensor('float32', new Float32Array(1 * 4 * 2048 * 336), [1, 4, 2048, 336]);

try {
    console.log('Running session.run...');
    const startTime = Date.now();
    const results = await session.run({ input: audioTensor, x: xTensor });
    console.log('Inference took', ((Date.now() - startTime) / 1000).toFixed(1), 's');

    for (const key of Object.keys(results)) {
        const t = results[key];
        const data = t.data;
        const samples = Math.min(1000, data.length);
        let maxAbs = 0;
        for (let i = 0; i < samples; i++) {
            if (Math.abs(data[i]) > maxAbs) maxAbs = Math.abs(data[i]);
        }
        console.log(`\nOutput "${key}":`);
        console.log(`  dims: [${t.dims}]`);
        console.log(`  data.length: ${data.length}`);
        console.log(`  max_abs (first ${samples}): ${maxAbs}`);

        if (maxAbs > 0) {
            console.log('  ✅ HAS AUDIO SIGNAL');
            // Print layout info to help understand structure
            const w = t.dims[t.dims.length - 1]; // last dim
            console.log(`  Layout check: first values: [${Array.from(data.slice(0, 10)).map(x => x.toFixed(4)).join(', ')}]`);
        } else {
            console.log('  ❌ SILENT (all zeros)');
        }
    }
} catch (e) {
    console.error('❌ Inference failed:', e.message);
    process.exit(1);
}
