const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const app = express();
app.set('trust proxy', true);

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 120000,
  pingInterval: 25000
});

// 静态文件缓存 1 小时
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

// 健康检查
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size, connections: io.engine.clientsCount });
});

// ============ 游戏数据 ============
const rooms = new Map(); // roomId -> roomState
const sessions = new Map(); // token -> { roomId, socketId, name, disconnectTimer }
const RECONNECT_GRACE = 30000; // 30秒断线重连窗口
const MAX_LOG_ENTRIES = 100; // 游戏日志上限
const ROOM_IDLE_TIMEOUT = 30 * 60 * 1000; // 30分钟无活动房间清理

// 预设词库
const wordPairs = [
  ['五条悟', '甚尔'],
  ['电锯人', '咒术回战'],
  ['间谍过家家', '派对浪客'],
  ['孤独摇滚', '轻音少女'],
  ['蓝色监狱', '排球少年'],
  ['葬送的芙莉莲', '药屋少女'],
  ['鬼灭之刃', '进击的巨人'],
  ['我推的孩子', '辉夜大小姐'],
  ['转生史莱姆', '盾之勇者'],
  ['无职转生', '蘑菇人'],
  ['伍六七', '一人之下'],
  ['spy family', 'frieren'],
  ['异世界转生', '回档重来'],
  ['龙傲天', '废柴逆袭'],
  ['漫展', 'comicup'],
  ['轻小说', '网文'],
  ['emo', '社恐'],
  ['二创', '同人'],
  ['声优', 'vtuber'],
  ['新番', '完结撒花']
];

// ============ 房间管理 ============
function createRoom(hostId, hostName) {
  let roomId;
  do {
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(roomId));
  const room = {
    id: roomId,
    hostId: hostId,
    players: new Map(), // socketId -> playerState
    phase: 'waiting', // waiting, night, day, vote, ended
    round: 0,
    settings: {
      undercoverCount: 1,
      angelCount: 0,
      blankCount: 0,
      wordSource: 'builtin', // 'builtin' | 'upload' | 'angel'
      dayTimer: 120,   // 白天讨论秒数
      nightTimer: 30,  // 夜晚行动秒数
      voteTimer: 30    // 投票秒数
    },
    goodWord: '',
    badWord: '',
    customWordPairs: [],  // 上传的自定义词库
    angelWords: null,     // 天使出的词 {wordA, wordB}
    nightActions: new Map(), // socketId -> targetId
    votes: new Map(), // voterId -> targetId
    dayDiscussionOrder: [],
    currentSpeaker: 0,
    eliminatedTonight: [],
    gameLog: [],
    timer: null,       // setTimeout reference
    timerEnd: null,    // timestamp when timer expires
    spectators: new Map(), // socketId -> {id, name}
    _lastActivity: Date.now()
  };
  rooms.set(roomId, room);
  return room;
}

function getPlayerState(player, forSelf = false) {
  const state = {
    id: player.id,
    name: player.name,
    alive: player.alive,
    role: forSelf ? player.role : undefined,
    word: forSelf ? player.word : undefined
  };
  return state;
}

function getRoomState(room, playerId) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: id === playerId ? p.role : (room.phase === 'ended' ? p.role : undefined),
      word: id === playerId ? p.word : (room.phase === 'ended' ? p.word : undefined)
    });
  }
  return {
    id: room.id,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    players,
    settings: room.settings,
    currentSpeaker: room.phase === 'day' ? room.dayDiscussionOrder[room.currentSpeaker] : null,
    gameLog: room.gameLog,
    timerEnd: room.timerEnd
  };
}

// 天使出词模式：先分配所有角色（但不分配词语），然后等天使出词
function preAssignAngel(room) {
  const playerIds = Array.from(room.players.keys());
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const { undercoverCount, angelCount, blankCount } = room.settings;

  // 重置所有玩家
  for (const [_, p] of room.players) {
    p.role = null;
    p.word = null;
    p.alive = true;
  }

  let index = 0;

  // 分配卧底
  for (let i = 0; i < undercoverCount && index < shuffled.length; i++, index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'undercover';
    player.word = '等待天使出词...';
  }

  // 分配天使
  for (let i = 0; i < angelCount && index < shuffled.length; i++, index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'angel';
    player.word = '请出两个相似的词';
  }

  // 分配白板
  for (let i = 0; i < blankCount && index < shuffled.length; i++, index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'blank';
    player.word = '（无词）';
  }

  // 剩余为好人
  for (; index < shuffled.length; index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'good';
    player.word = '等待天使出词...';
  }
}

// 天使出完词后，分配词语并开始游戏
function finishAngelPick(room) {
  // 用天使出的词，随机选一个作为好人词/坏人词
  const pair = [room.angelWords.wordA, room.angelWords.wordB];
  if (Math.random() > 0.5) {
    room.goodWord = pair[0];
    room.badWord = pair[1];
  } else {
    room.goodWord = pair[1];
    room.badWord = pair[0];
  }

  // 根据已分配的角色，分配词语
  for (const [_, p] of room.players) {
    switch (p.role) {
      case 'good':
        p.word = room.goodWord;
        break;
      case 'undercover':
        p.word = room.badWord;
        break;
      case 'angel':
        // 天使看到两个词但不知道哪个对应哪方
        if (Math.random() > 0.5) {
          p.word = `词A: ${room.goodWord} / 词B: ${room.badWord}`;
        } else {
          p.word = `词A: ${room.badWord} / 词B: ${room.goodWord}`;
        }
        break;
      case 'blank':
        p.word = '（无词）';
        break;
    }
  }

  room.gameLog.push({ type: 'phase', message: '天使已出词，游戏开始！' });
  room.round = 1;
  startDayPhase(room);
}

function assignRoles(room) {
  const playerIds = Array.from(room.players.keys());
  const totalPlayers = playerIds.length;
  const { undercoverCount, angelCount, blankCount } = room.settings;

  // 选择词对
  let pair;
  if (room.settings.wordSource === 'angel' && room.angelWords) {
    pair = [room.angelWords.wordA, room.angelWords.wordB];
  } else if (room.settings.wordSource === 'upload' && room.customWordPairs.length > 0) {
    pair = room.customWordPairs[Math.floor(Math.random() * room.customWordPairs.length)];
  } else {
    pair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
  }
  // 随机决定哪个是好人词哪个是坏人词
  if (Math.random() > 0.5) {
    room.goodWord = pair[0];
    room.badWord = pair[1];
  } else {
    room.goodWord = pair[1];
    room.badWord = pair[0];
  }

  // 打乱玩家顺序
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);

  let index = 0;

  // 分配卧底
  for (let i = 0; i < undercoverCount && index < shuffled.length; i++, index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'undercover';
    player.word = room.badWord;
  }

  // 分配天使
  for (let i = 0; i < angelCount && index < shuffled.length; i++, index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'angel';
    // 天使知道两个词但不知道哪个是好人词哪个是坏人词
    if (Math.random() > 0.5) {
      player.word = `词A: ${room.goodWord} / 词B: ${room.badWord}`;
    } else {
      player.word = `词A: ${room.badWord} / 词B: ${room.goodWord}`;
    }
  }

  // 分配白板
  for (let i = 0; i < blankCount && index < shuffled.length; i++, index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'blank';
    player.word = '（无词）';
  }

  // 剩余为好人
  for (; index < shuffled.length; index++) {
    const player = room.players.get(shuffled[index]);
    player.role = 'good';
    player.word = room.goodWord;
  }
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
  room.timerEnd = null;
}

function setRoomTimer(room, seconds, callback) {
  clearRoomTimer(room);
  room.timerEnd = Date.now() + seconds * 1000;
  room.timer = setTimeout(() => {
    room.timer = null;
    room.timerEnd = null;
    callback();
  }, seconds * 1000);
}

function startNightPhase(room) {
  room.phase = 'night';
  room.nightActions.clear();
  room.eliminatedTonight = [];
  room.gameLog.push({ type: 'phase', message: `第 ${room.round} 夜晚开始` });

  // 夜晚计时器：时间到未行动的人自动跳过
  setRoomTimer(room, room.settings.nightTimer, () => {
    if (room.phase !== 'night') return; // 防止竞态
    // 未行动的玩家自动跳过
    const alivePlayers = Array.from(room.players.entries())
      .filter(([_, p]) => p.alive);
    for (const [id] of alivePlayers) {
      if (!room.nightActions.has(id)) {
        room.nightActions.set(id, null);
      }
    }
    resolveNight(room);
  });

  broadcastRoomState(room);
}

function resolveNight(room) {
  const killed = new Set();
  const suicided = new Set();

  for (const [actorId, targetId] of room.nightActions) {
    const actor = room.players.get(actorId);
    if (!actor || !actor.alive) continue;
    if (!targetId) continue; // 跳过不行动的玩家

    if (actor.role === 'good' || actor.role === 'angel' || actor.role === 'blank') {
      // 好人/天使/白板刀人 → 自杀
      suicided.add(actorId);
    } else if (actor.role === 'undercover') {
      // 卧底刀人 → 目标死亡
      killed.add(targetId);
    }
  }

  // 处理死亡
  for (const id of killed) {
    const p = room.players.get(id);
    if (p) p.alive = false;
  }
  for (const id of suicided) {
    const p = room.players.get(id);
    if (p) p.alive = false;
  }

  room.eliminatedTonight = [...killed, ...suicided];

  // 只公布谁死了，不暴露死因（保护角色信息）
  for (const id of room.eliminatedTonight) {
    const p = room.players.get(id);
    if (p) {
      room.gameLog.push({ type: 'night', message: `${p.name} 在夜晚中死去` });
    }
  }

  // 检查胜负
  if (checkWinCondition(room)) return;

  // 进入白天（新一轮）
  room.round++;
  startDayPhase(room);
}

function startDayPhase(room) {
  room.phase = 'day';
  room.votes.clear();
  // 随机决定发言顺序
  const alivePlayers = Array.from(room.players.entries())
    .filter(([_, p]) => p.alive)
    .map(([id]) => id);
  room.dayDiscussionOrder = alivePlayers.sort(() => Math.random() - 0.5);
  room.currentSpeaker = 0;

  if (room.round > 1) {
    if (room.eliminatedTonight.length === 0) {
      room.gameLog.push({ type: 'phase', message: '天亮了，昨晚是平安夜' });
    } else {
      room.gameLog.push({ type: 'phase', message: '天亮了，请查看昨晚情况' });
    }
  }

  room.gameLog.push({ type: 'phase', message: '白天讨论阶段开始，请自由发言' });

  // 白天讨论计时器
  setRoomTimer(room, room.settings.dayTimer, () => {
    if (room.phase !== 'day') return; // 防止竞态
    // 第一天不投票
    if (room.round === 1) {
      room.gameLog.push({ type: 'phase', message: '讨论时间结束，进入夜晚' });
      startNightPhase(room);
    } else {
      startVotePhase(room);
    }
  });

  broadcastRoomState(room);
}

function startVotePhase(room) {
  clearRoomTimer(room);
  room.phase = 'vote';
  room.votes.clear();
  room.gameLog.push({ type: 'phase', message: '投票阶段开始' });

  // 投票计时器：时间到未投票的人视为弃票
  setRoomTimer(room, room.settings.voteTimer, () => {
    if (room.phase !== 'vote') return; // 防止竞态
    resolveVote(room);
  });

  broadcastRoomState(room);
}

function resolveVote(room) {
  const voteCount = new Map();
  for (const [_, targetId] of room.votes) {
    voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
  }

  // 找最高票
  let maxVotes = 0;
  let maxTargets = [];
  for (const [targetId, count] of voteCount) {
    if (count > maxVotes) {
      maxVotes = count;
      maxTargets = [targetId];
    } else if (count === maxVotes) {
      maxTargets.push(targetId);
    }
  }

  if (maxTargets.length === 1 && maxVotes > 0) {
    const eliminated = room.players.get(maxTargets[0]);
    if (eliminated) {
      eliminated.alive = false;
      room.gameLog.push({ type: 'vote', message: `${eliminated.name} 被投票淘汰了（${maxVotes}票）` });
    }
  } else {
    room.gameLog.push({ type: 'vote', message: '平票，无人被淘汰' });
  }

  // 检查胜负
  if (checkWinCondition(room)) return;

  // 进入夜晚
  startNightPhase(room);
}

function checkWinCondition(room) {
  const alive = Array.from(room.players.values()).filter(p => p.alive);
  const undercoverAlive = alive.filter(p => p.role === 'undercover');
  const blankAlive = alive.filter(p => p.role === 'blank');
  const nonUndercoverAlive = alive.filter(p => p.role !== 'undercover');

  // 白板胜利：白板存活且场上只剩≤2人（含白板自己）
  if (blankAlive.length > 0 && alive.length <= 2) {
    room.phase = 'ended';
    clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '🃏 白板胜利！白板活到了最终局！' });
    broadcastRoomState(room);
    return true;
  }

  // 卧底胜利：所有非卧底都死了
  if (undercoverAlive.length > 0 && nonUndercoverAlive.length === 0) {
    room.phase = 'ended';
    clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '😈 卧底阵营胜利！所有非卧底已被淘汰！' });
    broadcastRoomState(room);
    return true;
  }

  // 好人胜利：所有卧底被淘汰（且白板未触发胜利）
  if (undercoverAlive.length === 0) {
    room.phase = 'ended';
    clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '🎉 好人阵营胜利！所有卧底已被淘汰！' });
    broadcastRoomState(room);
    return true;
  }

  return false;
}

function broadcastRoomState(room) {
  room._lastActivity = Date.now();
  // 截断过长的日志
  if (room.gameLog.length > MAX_LOG_ENTRIES) {
    room.gameLog = room.gameLog.slice(-MAX_LOG_ENTRIES);
  }
  for (const [socketId, player] of room.players) {
    io.to(socketId).emit('roomState', getRoomState(room, socketId));
  }
  // 观战者收到无身份信息的状态
  const spectatorState = getRoomState(room, null);
  spectatorState.isSpectator = true;
  for (const [socketId] of room.spectators) {
    io.to(socketId).emit('roomState', spectatorState);
  }
}

// ============ Socket.IO 事件 ============
io.on('connection', (socket) => {
  let currentRoom = null;
  let playerName = '';
  let sessionToken = null;

  // 简易频率限制：每秒最多 10 条消息
  let msgCount = 0;
  let msgResetTimer = null;
  function rateLimit() {
    if (!msgResetTimer) {
      msgResetTimer = setTimeout(() => { msgCount = 0; msgResetTimer = null; }, 1000);
    }
    msgCount++;
    if (msgCount > 10) {
      socket.emit('error', '操作太频繁，请稍后再试');
      return true;
    }
    return false;
  }

  socket.on('createRoom', (name, callback) => {
    playerName = name.trim().substring(0, 10);
    const room = createRoom(socket.id, playerName);
    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      alive: true,
      role: null,
      word: null
    });
    currentRoom = room;
    sessionToken = uuidv4();
    sessions.set(sessionToken, { roomId: room.id, socketId: socket.id, name: playerName, disconnectTimer: null });
    socket.join(room.id);
    callback({ success: true, roomId: room.id, token: sessionToken });
    broadcastRoomState(room);
  });

  socket.on('joinRoom', (data, callback) => {
    const { name, roomId } = data;
    playerName = name.trim().substring(0, 10);
    const room = rooms.get(roomId.toUpperCase());

    if (!room) {
      callback({ success: false, error: '房间不存在' });
      return;
    }

    // 游戏已开始，以观战者身份加入
    if (room.phase !== 'waiting') {
      room.spectators.set(socket.id, { id: socket.id, name: playerName });
      currentRoom = room;
      socket.join(room.id);
      callback({ success: true, roomId: room.id, spectator: true });
      const spectatorState = getRoomState(room, null);
      spectatorState.isSpectator = true;
      socket.emit('roomState', spectatorState);
      return;
    }

    if (room.players.size >= 12) {
      callback({ success: false, error: '房间已满（最多12人）' });
      return;
    }

    room.players.set(socket.id, {
      id: socket.id,
      name: playerName,
      alive: true,
      role: null,
      word: null
    });
    currentRoom = room;
    sessionToken = uuidv4();
    sessions.set(sessionToken, { roomId: room.id, socketId: socket.id, name: playerName, disconnectTimer: null });
    socket.join(room.id);
    callback({ success: true, roomId: room.id, token: sessionToken });
    broadcastRoomState(room);
  });

  // 断线重连
  socket.on('rejoinRoom', (token, callback) => {
    const session = sessions.get(token);
    if (!session) {
      callback({ success: false, error: '会话已过期' });
      return;
    }

    const room = rooms.get(session.roomId);
    if (!room) {
      sessions.delete(token);
      callback({ success: false, error: '房间已关闭' });
      return;
    }

    // 取消断线倒计时
    if (session.disconnectTimer) {
      clearTimeout(session.disconnectTimer);
      session.disconnectTimer = null;
    }

    const oldSocketId = session.socketId;
    const newSocketId = socket.id;

    // 恢复玩家身份（将旧 socketId 映射到新的）
    const player = room.players.get(oldSocketId);
    if (player) {
      room.players.delete(oldSocketId);
      player.id = newSocketId;
      room.players.set(newSocketId, player);

      // 更新房主ID
      if (room.hostId === oldSocketId) {
        room.hostId = newSocketId;
      }

      // 更新夜晚行动中的引用
      if (room.nightActions.has(oldSocketId)) {
        const target = room.nightActions.get(oldSocketId);
        room.nightActions.delete(oldSocketId);
        room.nightActions.set(newSocketId, target);
      }
      // 更新作为目标的引用
      for (const [actorId, targetId] of room.nightActions) {
        if (targetId === oldSocketId) {
          room.nightActions.set(actorId, newSocketId);
        }
      }

      // 更新投票中的引用
      if (room.votes.has(oldSocketId)) {
        const target = room.votes.get(oldSocketId);
        room.votes.delete(oldSocketId);
        room.votes.set(newSocketId, target);
      }
      for (const [voterId, targetId] of room.votes) {
        if (targetId === oldSocketId) {
          room.votes.set(voterId, newSocketId);
        }
      }

      // 更新发言顺序
      const speakerIdx = room.dayDiscussionOrder.indexOf(oldSocketId);
      if (speakerIdx !== -1) {
        room.dayDiscussionOrder[speakerIdx] = newSocketId;
      }
    } else {
      // 可能是观战者重连
      const spectator = room.spectators.get(oldSocketId);
      if (spectator) {
        room.spectators.delete(oldSocketId);
        spectator.id = newSocketId;
        room.spectators.set(newSocketId, spectator);
      } else {
        sessions.delete(token);
        callback({ success: false, error: '玩家已被移除' });
        return;
      }
    }

    // 更新 session
    session.socketId = newSocketId;
    sessionToken = token;
    playerName = session.name;
    currentRoom = room;
    socket.join(room.id);

    const isSpectator = room.spectators.has(newSocketId);
    callback({ success: true, roomId: room.id, spectator: isSpectator });

    // 发送当前状态
    if (isSpectator) {
      const spectatorState = getRoomState(room, null);
      spectatorState.isSpectator = true;
      socket.emit('roomState', spectatorState);
    } else {
      socket.emit('roomState', getRoomState(room, newSocketId));
    }
  });

  socket.on('updateSettings', (settings) => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    if (currentRoom.phase !== 'waiting') return;

    const total = currentRoom.players.size;
    const { undercoverCount, angelCount, blankCount, dayTimer, nightTimer, voteTimer } = settings;

    // 验证角色设置
    if (undercoverCount + angelCount + blankCount >= total) return;
    if (undercoverCount < 1) return;

    // 验证计时器设置 (30-300秒)
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v || min));

    currentRoom.settings = {
      undercoverCount,
      angelCount,
      blankCount,
      wordSource: settings.wordSource || 'builtin',
      dayTimer: clamp(dayTimer, 30, 300),
      nightTimer: clamp(nightTimer, 15, 120),
      voteTimer: clamp(voteTimer, 15, 120)
    };
    broadcastRoomState(currentRoom);
  });

  // 上传自定义词库（JSON数组 [["词A","词B"], ...]）
  socket.on('uploadWords', (data) => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    if (currentRoom.phase !== 'waiting') return;
    if (!Array.isArray(data)) return socket.emit('error', '词库格式错误');
    // 验证：每项是长度2的数组，每个元素是非空字符串
    const valid = data.filter(p =>
      Array.isArray(p) && p.length === 2 &&
      typeof p[0] === 'string' && p[0].trim() &&
      typeof p[1] === 'string' && p[1].trim()
    ).map(p => [p[0].trim(), p[1].trim()]);
    if (valid.length === 0) return socket.emit('error', '词库中没有有效词对');
    currentRoom.customWordPairs = valid;
    socket.emit('uploadWordsOk', valid.length);
    broadcastRoomState(currentRoom);
  });

  // 天使出词
  socket.on('submitAngelWords', (data) => {
    if (!currentRoom) return;
    if (currentRoom.phase !== 'angelPick') return;
    // 验证出词者是天使
    const player = currentRoom.players.get(socket.id);
    if (!player || player.role !== 'angel') return;
    const { wordA, wordB } = data || {};
    if (!wordA || !wordB || typeof wordA !== 'string' || typeof wordB !== 'string') {
      return socket.emit('error', '请输入两个词');
    }
    if (wordA.trim() === wordB.trim()) {
      return socket.emit('error', '两个词不能相同');
    }
    currentRoom.angelWords = { wordA: wordA.trim(), wordB: wordB.trim() };
    // 天使出完词后，分配角色并开始游戏
    finishAngelPick(currentRoom);
  });

  socket.on('startGame', () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    if (currentRoom.phase !== 'waiting') return;
    if (currentRoom.players.size < 4) {
      socket.emit('error', '至少需要4名玩家');
      return;
    }

    const { undercoverCount, angelCount, blankCount, wordSource } = currentRoom.settings;
    if (undercoverCount + angelCount + blankCount >= currentRoom.players.size) {
      socket.emit('error', '角色数量设置不合理');
      return;
    }

    // 验证词源
    if (wordSource === 'upload' && currentRoom.customWordPairs.length === 0) {
      socket.emit('error', '请先上传词库');
      return;
    }
    if (wordSource === 'angel' && angelCount === 0) {
      socket.emit('error', '天使出词模式需要至少1名天使');
      return;
    }

    // 天使出词模式：先分配天使身份，进入出词阶段
    if (wordSource === 'angel') {
      preAssignAngel(currentRoom);
      currentRoom.phase = 'angelPick';
      currentRoom.gameLog = [];
      currentRoom.gameLog.push({ type: 'phase', message: '等待天使出词...' });
      broadcastRoomState(currentRoom);
      return;
    }

    assignRoles(currentRoom);
    currentRoom.gameLog = [];
    currentRoom.gameLog.push({ type: 'phase', message: '游戏开始！请查看你的身份和词语' });
    currentRoom.round = 1;
    startDayPhase(currentRoom);
  });

  socket.on('nightAction', (targetId) => {
    if (!currentRoom || currentRoom.phase !== 'night') return;
    const player = currentRoom.players.get(socket.id);
    if (!player || !player.alive) return;

    // 不能刀自己
    if (targetId === socket.id) return;

    // 验证目标存活
    if (targetId) {
      const target = currentRoom.players.get(targetId);
      if (!target || !target.alive) return;
      currentRoom.nightActions.set(socket.id, targetId);
    } else {
      currentRoom.nightActions.delete(socket.id);
    }

    // 通知该玩家已提交
    socket.emit('nightActionConfirmed', targetId);

    // 检查是否所有存活玩家都已行动
    const alivePlayers = Array.from(currentRoom.players.entries())
      .filter(([_, p]) => p.alive);
    const allActed = alivePlayers.every(([id]) =>
      currentRoom.nightActions.has(id)
    );

    // 广播已行动人数
    const actedCount = alivePlayers.filter(([id]) =>
      currentRoom.nightActions.has(id)
    ).length;
    io.to(currentRoom.id).emit('nightProgress', {
      acted: actedCount,
      total: alivePlayers.length
    });

    if (allActed) {
      clearRoomTimer(currentRoom);
      resolveNight(currentRoom);
    }
  });

  socket.on('skipNight', () => {
    if (!currentRoom || currentRoom.phase !== 'night') return;
    const player = currentRoom.players.get(socket.id);
    if (!player || !player.alive) return;

    // 跳过 = 不刀人
    currentRoom.nightActions.set(socket.id, null);
    socket.emit('nightActionConfirmed', null);

    const alivePlayers = Array.from(currentRoom.players.entries())
      .filter(([_, p]) => p.alive);
    const allActed = alivePlayers.every(([id]) =>
      currentRoom.nightActions.has(id)
    );

    const actedCount = alivePlayers.filter(([id]) =>
      currentRoom.nightActions.has(id)
    ).length;
    io.to(currentRoom.id).emit('nightProgress', {
      acted: actedCount,
      total: alivePlayers.length
    });

    if (allActed) {
      clearRoomTimer(currentRoom);
      resolveNight(currentRoom);
    }
  });

  socket.on('endDiscussion', () => {
    if (!currentRoom) return;
    if (currentRoom.phase !== 'day') return;
    if (currentRoom.hostId !== socket.id) return;

    clearRoomTimer(currentRoom);

    // 第一天不投票，直接进入夜晚
    if (currentRoom.round === 1) {
      currentRoom.gameLog.push({ type: 'phase', message: '第一天不投票，直接进入夜晚' });
      startNightPhase(currentRoom);
    } else {
      startVotePhase(currentRoom);
    }
  });

  socket.on('vote', (targetId) => {
    if (!currentRoom || currentRoom.phase !== 'vote') return;
    const player = currentRoom.players.get(socket.id);
    if (!player || !player.alive) return;

    if (targetId === socket.id) return; // 不能投自己

    // 验证目标存活
    const target = currentRoom.players.get(targetId);
    if (!target || !target.alive) return;

    currentRoom.votes.set(socket.id, targetId);

    // 检查是否所有存活玩家都已投票
    const alivePlayers = Array.from(currentRoom.players.entries())
      .filter(([_, p]) => p.alive);
    const allVoted = alivePlayers.every(([id]) =>
      currentRoom.votes.has(id)
    );

    const votedCount = alivePlayers.filter(([id]) =>
      currentRoom.votes.has(id)
    ).length;
    io.to(currentRoom.id).emit('voteProgress', {
      voted: votedCount,
      total: alivePlayers.length
    });

    if (allVoted) {
      clearRoomTimer(currentRoom);
      resolveVote(currentRoom);
    }
  });

  socket.on('sendMessage', (message) => {
    if (rateLimit()) return;
    if (!currentRoom) return;
    if (currentRoom.phase !== 'day') return;
    const player = currentRoom.players.get(socket.id);
    if (!player || !player.alive) return;

    const sanitized = String(message || '').trim().substring(0, 200);
    if (!sanitized) return;

    io.to(currentRoom.id).emit('chatMessage', {
      name: player.name,
      message: sanitized,
      playerId: socket.id
    });
  });

  socket.on('restartGame', () => {
    if (!currentRoom || currentRoom.hostId !== socket.id) return;
    if (currentRoom.phase !== 'ended') return;

    // 重置所有玩家状态
    for (const [_, player] of currentRoom.players) {
      player.alive = true;
      player.role = null;
      player.word = null;
    }
    currentRoom.phase = 'waiting';
    currentRoom.round = 0;
    currentRoom.nightActions.clear();
    currentRoom.votes.clear();
    currentRoom.gameLog = [];
    currentRoom.angelWords = null;
    broadcastRoomState(currentRoom);
  });

  socket.on('disconnect', () => {
    if (!currentRoom) return;

    // 观战者离开：无需保留
    if (currentRoom.spectators.has(socket.id)) {
      currentRoom.spectators.delete(socket.id);
      if (sessionToken) sessions.delete(sessionToken);
      return;
    }

    // 等待阶段或游戏结束：立即移除（无需保留位置）
    if (currentRoom.phase === 'waiting' || currentRoom.phase === 'ended') {
      currentRoom.players.delete(socket.id);
      if (sessionToken) sessions.delete(sessionToken);

      if (currentRoom.players.size === 0) {
        clearRoomTimer(currentRoom);
        rooms.delete(currentRoom.id);
        return;
      }
      if (currentRoom.hostId === socket.id) {
        currentRoom.hostId = currentRoom.players.keys().next().value;
      }
      broadcastRoomState(currentRoom);
      return;
    }

    // 游戏进行中断线：给予重连宽限期
    const session = sessionToken ? sessions.get(sessionToken) : null;
    if (session) {
      const roomRef = currentRoom;
      const disconnectedId = socket.id;
      const disconnectedPlayer = roomRef.players.get(disconnectedId);

      // 标记为断线（但保留在 players Map 中）
      if (disconnectedPlayer) {
        disconnectedPlayer._disconnected = true;
        roomRef.gameLog.push({ type: 'phase', message: `${disconnectedPlayer.name} 断线，等待重连...` });
        broadcastRoomState(roomRef);
      }

      session.disconnectTimer = setTimeout(() => {
        session.disconnectTimer = null;
        sessions.delete(sessionToken);

        // 宽限期到，正式移除
        const player = roomRef.players.get(disconnectedId);
        if (!player) return; // 已被处理
        delete player._disconnected;
        roomRef.players.delete(disconnectedId);

        if (roomRef.players.size === 0) {
          clearRoomTimer(roomRef);
          rooms.delete(roomRef.id);
          return;
        }

        if (roomRef.hostId === disconnectedId) {
          roomRef.hostId = roomRef.players.keys().next().value;
        }

        // 天使出词阶段天使掉线 → 回到等待
        if (roomRef.phase === 'angelPick' && player.role === 'angel') {
          clearRoomTimer(roomRef);
          roomRef.phase = 'waiting';
          roomRef.gameLog.push({ type: 'phase', message: '天使已离开，游戏取消' });
          for (const [_, p] of roomRef.players) {
            p.role = null;
            p.word = null;
            p.alive = true;
          }
          broadcastRoomState(roomRef);
          return;
        }

        // 游戏进行中正式离开
        roomRef.gameLog.push({ type: 'phase', message: `${player.name} 断线超时，已移除` });
        if (!checkWinCondition(roomRef)) {
          broadcastRoomState(roomRef);
        }
      }, RECONNECT_GRACE);
    } else {
      // 无 session（不该发生，但兜底处理）
      const disconnectedPlayer = currentRoom.players.get(socket.id);
      currentRoom.players.delete(socket.id);

      if (currentRoom.players.size === 0) {
        clearRoomTimer(currentRoom);
        rooms.delete(currentRoom.id);
        return;
      }
      if (currentRoom.hostId === socket.id) {
        currentRoom.hostId = currentRoom.players.keys().next().value;
      }
      if (disconnectedPlayer) {
        currentRoom.gameLog.push({ type: 'phase', message: `${disconnectedPlayer.name} 断线离开` });
      }
      if (!checkWinCondition(currentRoom)) {
        broadcastRoomState(currentRoom);
      }
    }
  });
});

// ============ 启动服务器 ============
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});

// 定时清理空闲房间（每5分钟）
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    // 空房间或长时间无人在等待中的房间
    if (room.players.size === 0) {
      clearRoomTimer(room);
      rooms.delete(roomId);
    } else if (room.phase === 'waiting' && room._lastActivity && now - room._lastActivity > ROOM_IDLE_TIMEOUT) {
      clearRoomTimer(room);
      rooms.delete(roomId);
      // 通知还在房间的人
      for (const [socketId] of room.players) {
        io.to(socketId).emit('error', '房间因长时间无活动已关闭');
      }
    }
  }
}, 5 * 60 * 1000);

// 优雅关闭（Cloud Run SIGTERM）
function gracefulShutdown() {
  console.log('收到关闭信号，开始清理...');
  io.emit('error', '服务器正在重启，请稍后重连');
  io.close();
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
  // 10秒后强制退出
  setTimeout(() => process.exit(1), 10000);
}
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
