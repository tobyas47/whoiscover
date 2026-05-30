// ============ 服务器入口 ============
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { ROOM_IDLE_TIMEOUT } = require('./data');
const { rooms, clearRoomTimer } = require('./room');
const { registerSocketHandlers } = require('./socket');

const app = express();
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 120000,
  pingInterval: 25000
});

// 图片代理 — 用于将 Bangumi 封面图代理到同源，供客户端 Canvas 使用
app.get('/api/hint-image', async (req, res) => {
  const { url } = req.query;
  if (typeof url !== 'string' || !url.startsWith('https://lain.bgm.tv/')) {
    return res.status(400).end();
  }
  try {
    const imgRes = await fetch(url, { headers: { 'User-Agent': 'whoiscover-game/1.0' } });
    if (!imgRes.ok) return res.status(404).end();
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.set('Content-Type', imgRes.headers.get('content-type') || 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(buffer);
  } catch {
    res.status(502).end();
  }
});

// 静态文件 — production serves dist/, development falls back to public/
const distPath = path.join(__dirname, '..', 'dist');
const publicPath = path.join(__dirname, '..', 'public');
const fs = require('fs');
const staticRoot = fs.existsSync(distPath) ? distPath : publicPath;
app.use(express.static(staticRoot, {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size, connections: io.engine.clientsCount });
});

// 注册 Socket 事件
registerSocketHandlers(io);

// 启动
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

// 定时清理空闲房间
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.players.size === 0) {
      clearRoomTimer(room); rooms.delete(roomId);
    } else if (room.phase === 'waiting' && room._lastActivity && now - room._lastActivity > ROOM_IDLE_TIMEOUT) {
      clearRoomTimer(room); rooms.delete(roomId);
    }
  }
}, 5 * 60 * 1000);
