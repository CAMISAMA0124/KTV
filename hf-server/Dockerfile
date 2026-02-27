FROM node:18-slim

# 安裝必要組件: ffmpeg, curl
RUN apt-get update && apt-get install -y ffmpeg curl python3 python3-pip \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 設定環境變數
ENV PORT=7860
ENV NODE_ENV=production

# 複製 package.json (復用現有邏輯)
COPY ./render-server/package*.json ./
RUN npm install

# 複製源碼
COPY ./render-server/ ./

# Hugging Face Spaces 必須聽 7860 端口
EXPOSE 7860

CMD ["node", "server.js"]
