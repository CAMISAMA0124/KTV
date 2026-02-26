# ✨ 一鍵歡唱KTV (iPhone AI Stem Separator)

這是一個專為 iPhone 與行動裝置設計的高效能 KTV 應用程式。利用 WebGPU 技術在本地端進行 AI 音軌分離（人聲/伴奏），並整合 YouTube 搜尋與同步播放功能。

## 🚀 核心特色

- **100% 本地運算**：音訊不外傳，保護隱私且節省流量。
- **WebGPU 加速**：利用 iPhone GPU 全力運算，達到近乎即時的分離速度。
- **YouTube 整合**：直接搜尋歌曲，一鍵匯入。
- **專業 KTV 體驗**：支援即時升降調、原唱/伴奏一鍵切換。
- **智慧快取**：AI 模型僅需下載一次，後續開啟秒速啟動。

## 🛠️ 技術棧

- **Frontend**: Vite, Vanilla JS, CSS3 (Glassmorphism)
- **AI Engine**: ONNX Runtime Web (WebGPU/WASM)
- **Backend**: Node.js, Express (YouTube 擷取代理)
- **Tools**: yt-dlp, ffmpeg

## 📦 安裝與運行

### 1. 安裝依賴
```bash
npm install
```

### 2. 啟動開發伺服器
```bash
npm run dev:all
```
前端網址將運行於 `http://127.0.0.1:5173/`。

## 🌐 關於部署 (Vercel)

本專案的前端可以直接部署至 Vercel。部署後，原本在 `127.0.0.1` 下受限的 YouTube 播放器將因為有了正式網域而恢復正常播放。

**注意**：YouTube 擷取後端 (`/api/extract`) 需要一個支援 Node.js 與二進位執行檔的環境。建議將後端單獨部署至 Render 或 Railway，並在 `vite.config.js` 中修改代理設定。

---
Made with ❤️ for iPhone Users
