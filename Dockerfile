FROM node:20-slim

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# 非 root 用户运行
USER node

EXPOSE 8080

CMD ["node", "server.js"]
