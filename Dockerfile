# 使用輕量級 Node.js 基礎映像檔
FROM node:20-slim

# 安裝系統依賴：ffmpeg (音訊處理) 與 Python/wget (yt-dlp 必備)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python-is-python3 \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 設定工作目錄
WORKDIR /app

# 複製 package.json 並安裝所有依赖 (包含 Vite)
COPY package*.json ./
RUN npm install

# 複製所有代碼到容器內
COPY . .

# 編譯前端靜態檔案
RUN npm run build

# 確保 yt-dlp 二進位檔具備執行權限 (HF 預設使用 Linux 版本)
RUN mkdir -p node_modules/yt-dlp-exec/bin && \
    wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O node_modules/yt-dlp-exec/bin/yt-dlp && \
    chmod a+rx node_modules/yt-dlp-exec/bin/yt-dlp

# 設定環境變數
ENV PORT=7860
ENV NODE_ENV=production

# 暴露 HF Spaces 預設的 7860 端口
EXPOSE 7860

# 啟動後端伺服器 (指向你的 server/index.js)
CMD ["node", "server/index.js"]
