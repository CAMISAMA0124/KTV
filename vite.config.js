import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: {
    port: 5173,
    host: '127.0.0.1',
    // 移除 COOP/COEP 以允許 YouTube IFrame 正常播放
    headers: {},
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 5173,
    host: '127.0.0.1',
    headers: {},
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  worker: {
    format: 'es',
    // 解決 rollup 分塊問題
  },
  build: {
    target: 'esnext',
    minify: 'esbuild'
  }
});



