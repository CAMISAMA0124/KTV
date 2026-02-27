# 使用 Node.js 18 輕量版作為基底
FROM node:18-slim

# 安裝 Python, FFmpeg 與 Curl (下載工具所需)
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 下載並安裝 yt-dlp 到系統路徑
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

# 設定工作目錄
WORKDIR /app

# 複製依賴文件並安裝
COPY package*.json ./
RUN npm install

# 複製所有檔案
COPY . .

# 構建前端靜態檔案
RUN npm run build

# 設定環境變數
ENV NODE_ENV=production
ENV PORT=10000

# 開放連接埠 (Zeabur 引導)
EXPOSE 10000

# 啟動伺服器
CMD ["node", "server/index.js"]
