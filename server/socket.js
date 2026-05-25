// ============ Socket.IO 事件处理 ============
const { v4: uuidv4 } = require('uuid');
const { RECONNECT_GRACE } = require('./data');
const { rooms, sessions, createRoom, broadcastRoomState, getRoomState, clearRoomTimer } = require('./room');
const undercover = require('./undercover');
const drawguess = require('./drawguess');

function registerSocketHandlers(io) {
  undercover.init(io);
  drawguess.init(io);

  io.on('connection', (socket) => {
    let currentRoom = null;
    let playerName = '';
    let sessionToken = null;

    // 频率限制
    let msgCount = 0;
    let msgResetTimer = null;
    function rateLimit() {
      if (!msgResetTimer) {
        msgResetTimer = setTimeout(() => { msgCount = 0; msgResetTimer = null; }, 1000);
      }
      msgCount++;
      if (msgCount > 10) { socket.emit('error', '操作太频繁，请稍后再试'); return true; }
      return false;
    }

    // ---- 房间管理 ----
    socket.on('createRoom', (name, callback) => {
      playerName = name.trim().substring(0, 10);
      const room = createRoom(socket.id, playerName);
      room.players.set(socket.id, { id: socket.id, name: playerName, alive: true, role: null, word: null });
      currentRoom = room;
      sessionToken = uuidv4();
      sessions.set(sessionToken, { roomId: room.id, socketId: socket.id, name: playerName, disconnectTimer: null });
      socket.join(room.id);
      callback({ success: true, roomId: room.id, token: sessionToken });
      broadcastRoomState(room, io);
    });

    socket.on('joinRoom', (data, callback) => {
      if (!data || typeof data !== 'object') return callback({ success: false, error: '参数无效' });
      const { name, roomId } = data;
      if (!roomId || typeof roomId !== 'string') return callback({ success: false, error: '房间ID无效' });
      if (!name || typeof name !== 'string') return callback({ success: false, error: '昵称无效' });
      playerName = name.trim().substring(0, 10);
      const room = rooms.get(roomId.toUpperCase());

      if (!room) return callback({ success: false, error: '房间不存在' });

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

      if (room.players.size >= 12) return callback({ success: false, error: '房间已满（最多12人）' });

      room.players.set(socket.id, { id: socket.id, name: playerName, alive: true, role: null, word: null });
      currentRoom = room;
      sessionToken = uuidv4();
      sessions.set(sessionToken, { roomId: room.id, socketId: socket.id, name: playerName, disconnectTimer: null });
      socket.join(room.id);
      callback({ success: true, roomId: room.id, token: sessionToken });
      broadcastRoomState(room, io);
    });

    socket.on('rejoinRoom', (token, callback) => {
      const session = sessions.get(token);
      if (!session) return callback({ success: false, error: '会话已过期' });

      const room = rooms.get(session.roomId);
      if (!room) { sessions.delete(token); return callback({ success: false, error: '房间已关闭' }); }

      if (session.disconnectTimer) { clearTimeout(session.disconnectTimer); session.disconnectTimer = null; }

      const oldSocketId = session.socketId;
      const newSocketId = socket.id;
      const player = room.players.get(oldSocketId);

      if (player) {
        room.players.delete(oldSocketId);
        player.id = newSocketId;
        room.players.set(newSocketId, player);
        if (room.hostId === oldSocketId) room.hostId = newSocketId;

        // 更新各种引用
        if (room.nightActions.has(oldSocketId)) {
          room.nightActions.set(newSocketId, room.nightActions.get(oldSocketId));
          room.nightActions.delete(oldSocketId);
        }
        const nightActionsToUpdate = [];
        for (const [actorId, targetId] of room.nightActions) {
          if (targetId === oldSocketId) nightActionsToUpdate.push(actorId);
        }
        for (const actorId of nightActionsToUpdate) {
          room.nightActions.set(actorId, newSocketId);
        }
        if (room.votes.has(oldSocketId)) {
          room.votes.set(newSocketId, room.votes.get(oldSocketId));
          room.votes.delete(oldSocketId);
        }
        const votesToUpdate = [];
        for (const [voterId, targetId] of room.votes) {
          if (targetId === oldSocketId) votesToUpdate.push(voterId);
        }
        for (const voterId of votesToUpdate) {
          room.votes.set(voterId, newSocketId);
        }
        if (room.blankGuessPlayer === oldSocketId) room.blankGuessPlayer = newSocketId;
        const speakerIdx = room.dayDiscussionOrder.indexOf(oldSocketId);
        if (speakerIdx !== -1) room.dayDiscussionOrder[speakerIdx] = newSocketId;
      } else {
        const spectator = room.spectators.get(oldSocketId);
        if (spectator) {
          room.spectators.delete(oldSocketId);
          spectator.id = newSocketId;
          room.spectators.set(newSocketId, spectator);
        } else {
          sessions.delete(token);
          return callback({ success: false, error: '玩家已被移除' });
        }
      }

      session.socketId = newSocketId;
      sessionToken = token;
      playerName = session.name;
      currentRoom = room;
      socket.join(room.id);

      const isSpectator = room.spectators.has(newSocketId);
      callback({ success: true, roomId: room.id, spectator: isSpectator });

      if (isSpectator) {
        const spectatorState = getRoomState(room, null);
        spectatorState.isSpectator = true;
        socket.emit('roomState', spectatorState);
      } else {
        socket.emit('roomState', getRoomState(room, newSocketId));
      }
    });

    // ---- 设置 ----
    socket.on('updateSettings', (settings) => {
      if (!currentRoom || currentRoom.hostId !== socket.id) return;
      if (currentRoom.phase !== 'waiting') return;
      if (!settings || typeof settings !== 'object') return;

      const modeChanged = settings.mode && ['undercover', 'drawguess'].includes(settings.mode) && settings.mode !== currentRoom.mode;
      if (settings.mode && ['undercover', 'drawguess'].includes(settings.mode)) {
        currentRoom.mode = settings.mode;
      }

      if (currentRoom.mode === 'drawguess') {
        const clamp = (v, min, max) => Math.max(min, Math.min(max, v || min));
        currentRoom.dg.maxRounds = clamp(settings.dgMaxRounds, 1, 5);
        currentRoom.dg.drawTimer = clamp(settings.dgDrawTimer, 30, 9999);
        // 词源设置
        if (settings.dgWordSource && ['builtin', 'upload', 'bangumi'].includes(settings.dgWordSource)) {
          currentRoom.dgWordSource = settings.dgWordSource;
        }
        // Bangumi 参数
        if (settings.dgBangumiOpts && typeof settings.dgBangumiOpts === 'object') {
          const o = settings.dgBangumiOpts;
          currentRoom.dgBangumiOpts = {
            keyword: String(o.keyword || '').slice(0, 50),
            type: Array.isArray(o.type) ? o.type.filter(t => [1,2,3,4,6].includes(t)) : [2],
            year: o.year ? parseInt(o.year) || null : null,
            month: o.month ? parseInt(o.month) || null : null,
            tag: Array.isArray(o.tag) ? o.tag.map(t => String(t).slice(0, 20)).slice(0, 5) : [],
            sort: ['match','heat','rank','score'].includes(o.sort) ? o.sort : 'rank',
            limit: Math.min(Math.max(parseInt(o.limit) || 50, 10), 50)
          };
        }
        broadcastRoomState(currentRoom, io);
        return;
      }

      // If only the mode changed (back to undercover), broadcast immediately
      if (modeChanged) {
        broadcastRoomState(currentRoom, io);
        return;
      }

      const total = currentRoom.players.size;
      const { undercoverCount, angelCount, blankCount, dayTimer, nightTimer, voteTimer } = settings;
      if (undercoverCount + angelCount + blankCount >= total) return;
      if (undercoverCount < 1) return;

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v || min));
      currentRoom.settings = {
        undercoverCount, angelCount, blankCount,
        wordSource: settings.wordSource || 'builtin',
        dayTimer: clamp(dayTimer, 30, 9999),
        nightTimer: clamp(nightTimer, 15, 9999),
        voteTimer: clamp(voteTimer, 15, 9999)
      };
      broadcastRoomState(currentRoom, io);
    });

    // ---- 词库上传 ----
    socket.on('uploadWords', (data) => {
      if (!currentRoom || currentRoom.hostId !== socket.id) return;
      if (currentRoom.phase !== 'waiting') return;
      if (!Array.isArray(data)) return socket.emit('error', '词库格式错误');
      const valid = data.filter(p =>
        Array.isArray(p) && p.length === 2 &&
        typeof p[0] === 'string' && p[0].trim() &&
        typeof p[1] === 'string' && p[1].trim()
      ).map(p => [p[0].trim(), p[1].trim()]);
      if (valid.length === 0) return socket.emit('error', '词库中没有有效词对');
      currentRoom.customWordPairs = valid;
      currentRoom.settings.wordSource = 'upload';
      socket.emit('uploadWordsOk', valid.length);
      broadcastRoomState(currentRoom, io);
    });

    socket.on('uploadDgWords', (data) => {
      if (!currentRoom || currentRoom.hostId !== socket.id) return;
      if (currentRoom.phase !== 'waiting') return;
      if (!Array.isArray(data)) return socket.emit('error', '词库格式错误');
      const valid = data.filter(w => typeof w === 'string' && w.trim()).map(w => w.trim());
      if (valid.length < 3) return socket.emit('error', '词库至少需要3个词');
      currentRoom.customDgWords = valid;
      socket.emit('uploadDgWordsOk', valid.length);
      broadcastRoomState(currentRoom, io);
    });

    // ---- 天使出词 ----
    socket.on('submitAngelWords', (data) => {
      if (!currentRoom || currentRoom.phase !== 'angelPick') return;
      const player = currentRoom.players.get(socket.id);
      if (!player || player.role !== 'angel') return;
      const { wordA, wordB } = data || {};
      if (!wordA || !wordB || typeof wordA !== 'string' || typeof wordB !== 'string') return socket.emit('error', '请输入两个词');
      if (wordA.trim() === wordB.trim()) return socket.emit('error', '两个词不能相同');
      currentRoom.angelWords = { wordA: wordA.trim(), wordB: wordB.trim() };
      undercover.finishAngelPick(currentRoom);
    });

    // ---- 开始游戏 ----
    socket.on('startGame', () => {
      if (!currentRoom || currentRoom.hostId !== socket.id) return;
      if (currentRoom.phase !== 'waiting') return;

      if (currentRoom.mode === 'drawguess') {
        if (currentRoom.players.size < 2) return socket.emit('error', '至少需要2名玩家');
        drawguess.dgStartGame(currentRoom);
        return;
      }

      if (currentRoom.players.size < 4) return socket.emit('error', '至少需要4名玩家');
      const { undercoverCount, angelCount, blankCount, wordSource } = currentRoom.settings;
      if (undercoverCount + angelCount + blankCount >= currentRoom.players.size) return socket.emit('error', '角色数量设置不合理');
      if (wordSource === 'upload' && currentRoom.customWordPairs.length === 0) return socket.emit('error', '请先上传词库');
      if (wordSource === 'angel' && angelCount === 0) return socket.emit('error', '天使出词模式需要至少1名天使');

      if (wordSource === 'angel') {
        undercover.preAssignAngel(currentRoom);
        currentRoom.phase = 'angelPick';
        currentRoom.gameLog = [{ type: 'phase', message: '等待天使出词...' }];
        broadcastRoomState(currentRoom, io);
        return;
      }

      undercover.assignRoles(currentRoom);
      currentRoom.gameLog = [{ type: 'phase', message: '游戏开始！请查看你的身份和词语' }];
      currentRoom.round = 1;
      undercover.startDayPhase(currentRoom);
    });

    // ---- 夜晚行动 ----
    socket.on('nightAction', (data) => {
      if (!currentRoom || currentRoom.phase !== 'night') return;
      const player = currentRoom.players.get(socket.id);
      if (!player || !player.alive) return;
      const targetId = data && typeof data === 'object' ? data.targetId : data;
      if (targetId === socket.id) return;
      if (targetId) {
        const target = currentRoom.players.get(targetId);
        if (!target || !target.alive) return;
        currentRoom.nightActions.set(socket.id, targetId);
      } else {
        currentRoom.nightActions.set(socket.id, null);
      }
      socket.emit('nightActionConfirmed', targetId);

      const alivePlayers = Array.from(currentRoom.players.entries()).filter(([_, p]) => p.alive);
      const actedCount = alivePlayers.filter(([id]) => currentRoom.nightActions.has(id)).length;
      io.to(currentRoom.id).emit('nightProgress', { acted: actedCount, total: alivePlayers.length });

      if (alivePlayers.every(([id]) => currentRoom.nightActions.has(id))) {
        clearRoomTimer(currentRoom);
        undercover.resolveNight(currentRoom);
      }
    });

    socket.on('skipNight', () => {
      if (!currentRoom || currentRoom.phase !== 'night') return;
      const player = currentRoom.players.get(socket.id);
      if (!player || !player.alive) return;
      currentRoom.nightActions.set(socket.id, null);
      socket.emit('nightActionConfirmed', null);

      const alivePlayers = Array.from(currentRoom.players.entries()).filter(([_, p]) => p.alive);
      const actedCount = alivePlayers.filter(([id]) => currentRoom.nightActions.has(id)).length;
      io.to(currentRoom.id).emit('nightProgress', { acted: actedCount, total: alivePlayers.length });

      if (alivePlayers.every(([id]) => currentRoom.nightActions.has(id))) {
        clearRoomTimer(currentRoom);
        undercover.resolveNight(currentRoom);
      }
    });

    // ---- 白天 ----
    socket.on('endDiscussion', () => {
      if (!currentRoom || currentRoom.phase !== 'day' || currentRoom.hostId !== socket.id) return;
      clearRoomTimer(currentRoom);
      if (currentRoom.round === 1) {
        currentRoom.gameLog.push({ type: 'phase', message: '第一天不投票，直接进入夜晚' });
        undercover.startNightPhase(currentRoom);
      } else {
        undercover.startVotePhase(currentRoom);
      }
    });

    socket.on('confirmReady', () => {
      if (!currentRoom || currentRoom.phase !== 'day') return;
      const player = currentRoom.players.get(socket.id);
      if (!player || !player.alive) return;
      currentRoom.readyPlayers.add(socket.id);

      const aliveCount = Array.from(currentRoom.players.values()).filter(p => p.alive).length;
      if (currentRoom.readyPlayers.size >= aliveCount) {
        clearRoomTimer(currentRoom);
        if (currentRoom.round === 1) {
          currentRoom.gameLog.push({ type: 'phase', message: '所有人确认完成，进入夜晚' });
          undercover.startNightPhase(currentRoom);
        } else {
          undercover.startVotePhase(currentRoom);
        }
      } else {
        broadcastRoomState(currentRoom, io);
      }
    });

    // ---- 投票 ----
    socket.on('vote', (data) => {
      if (!currentRoom || currentRoom.phase !== 'vote') return;
      const player = currentRoom.players.get(socket.id);
      if (!player || !player.alive) return;
      const targetId = data && typeof data === 'object' ? data.targetId : data;
      if (targetId === null || targetId === undefined) currentRoom.votes.set(socket.id, null);
      else {
        if (targetId === socket.id) return;
        const target = currentRoom.players.get(targetId);
        if (!target || !target.alive) return;
        currentRoom.votes.set(socket.id, targetId);
      }

      const alivePlayers = Array.from(currentRoom.players.entries()).filter(([_, p]) => p.alive);
      const votedCount = alivePlayers.filter(([id]) => currentRoom.votes.has(id)).length;
      io.to(currentRoom.id).emit('voteProgress', { voted: votedCount, total: alivePlayers.length });

      if (alivePlayers.every(([id]) => currentRoom.votes.has(id))) {
        clearRoomTimer(currentRoom);
        undercover.resolveVote(currentRoom);
      }
    });

    // ---- 白板猜词 ----
    socket.on('submitBlankGuess', (data) => {
      if (!currentRoom || currentRoom.phase !== 'blankGuess') return;
      if (currentRoom.blankGuessPlayer !== socket.id) return;
      const { wordA, wordB } = data || {};
      if (!wordA || !wordB || typeof wordA !== 'string' || typeof wordB !== 'string') return socket.emit('error', '请输入两个词');
      clearRoomTimer(currentRoom);
      const guessA = wordA.trim(), guessB = wordB.trim();
      const correct = (guessA === currentRoom.goodWord && guessB === currentRoom.badWord) ||
                      (guessA === currentRoom.badWord && guessB === currentRoom.goodWord);
      currentRoom.phase = 'ended';
      currentRoom.gameLog.push({
        type: 'end',
        message: correct
          ? `🃏 白板猜词正确！（${guessA} / ${guessB}）白板独自胜利！`
          : `❌ 白板猜词错误（猜：${guessA} / ${guessB}），好人阵营胜利！`
      });
      currentRoom.blankGuessPlayer = null;
      broadcastRoomState(currentRoom, io);
    });

    // ---- 聊天 ----
    socket.on('sendMessage', (message) => {
      if (rateLimit()) return;
      if (!currentRoom) return;
      const player = currentRoom.players.get(socket.id);
      if (!player) return;
      const sanitized = String(message || '').trim().substring(0, 200);
      if (!sanitized) return;

      if (currentRoom.mode === 'drawguess' && currentRoom.phase === 'dgDrawing') {
        const isCorrect = drawguess.dgHandleGuess(currentRoom, socket.id, sanitized);
        if (isCorrect) return;
        if (socket.id !== currentRoom.dg.drawOrder[currentRoom.dg.currentIdx]) {
          io.to(currentRoom.id).emit('chatMessage', { name: player.name, message: sanitized, playerId: socket.id });
        }
        return;
      }

      if (currentRoom.mode !== 'drawguess') {
        if (currentRoom.phase !== 'day') return;
        if (!player.alive) return;
      }
      io.to(currentRoom.id).emit('chatMessage', { name: player.name, message: sanitized, playerId: socket.id });
    });

    // ---- 你画我猜 事件 ----
    socket.on('dgPickWord', (word) => {
      if (!currentRoom || currentRoom.mode !== 'drawguess' || currentRoom.phase !== 'dgPicking') return;
      const dg = currentRoom.dg;
      if (socket.id !== dg.drawOrder[dg.currentIdx]) return;
      if (!dg.wordChoices.includes(word)) return;
      dg.currentWord = word;
      drawguess.dgStartDrawing(currentRoom);
    });

    socket.on('dgStroke', (stroke) => {
      if (!currentRoom || currentRoom.mode !== 'drawguess' || currentRoom.phase !== 'dgDrawing') return;
      const dg = currentRoom.dg;
      if (socket.id !== dg.drawOrder[dg.currentIdx]) return;
      if (!stroke || typeof stroke !== 'object') return;
      dg.strokes.push(stroke);
      socket.to(currentRoom.id).emit('dgStroke', stroke);
    });

    socket.on('dgClear', () => {
      if (!currentRoom || currentRoom.mode !== 'drawguess' || currentRoom.phase !== 'dgDrawing') return;
      const dg = currentRoom.dg;
      if (socket.id !== dg.drawOrder[dg.currentIdx]) return;
      dg.strokes = [];
      socket.to(currentRoom.id).emit('dgClear');
    });

    socket.on('dgRestart', () => {
      if (!currentRoom || currentRoom.mode !== 'drawguess' || currentRoom.hostId !== socket.id) return;
      if (!['dgEnded', 'dgReveal', 'dgDrawing', 'dgPicking'].includes(currentRoom.phase)) return;
      clearRoomTimer(currentRoom);
      currentRoom.phase = 'waiting';
      currentRoom.gameLog = [];
      broadcastRoomState(currentRoom, io);
    });

    // ---- 重开 ----
    socket.on('restartGame', () => {
      if (!currentRoom || currentRoom.hostId !== socket.id) return;
      if (currentRoom.phase === 'waiting') return;
      clearRoomTimer(currentRoom);
      for (const [_, player] of currentRoom.players) { player.alive = true; player.role = null; player.word = null; }
      currentRoom.phase = 'waiting';
      currentRoom.round = 0;
      currentRoom.nightActions.clear();
      currentRoom.votes.clear();
      currentRoom.gameLog = [];
      currentRoom.angelWords = null;
      currentRoom.blankGuessPlayer = null;
      currentRoom.readyPlayers.clear();
      currentRoom.dg.scores = new Map();
      currentRoom.dg.strokes = [];
      currentRoom.dg.currentWord = '';
      currentRoom.dg.guessedPlayers = new Set();
      broadcastRoomState(currentRoom, io);
    });

    // ---- 断线 ----
    socket.on('disconnect', () => {
      if (!currentRoom) return;

      if (currentRoom.spectators.has(socket.id)) {
        currentRoom.spectators.delete(socket.id);
        if (sessionToken) sessions.delete(sessionToken);
        return;
      }

      if (currentRoom.phase === 'waiting' || currentRoom.phase === 'ended') {
        currentRoom.players.delete(socket.id);
        if (sessionToken) sessions.delete(sessionToken);
        if (currentRoom.players.size === 0) { clearRoomTimer(currentRoom); rooms.delete(currentRoom.id); return; }
        if (currentRoom.hostId === socket.id) currentRoom.hostId = currentRoom.players.keys().next().value;
        broadcastRoomState(currentRoom, io);
        return;
      }

      const session = sessionToken ? sessions.get(sessionToken) : null;
      if (session) {
        const roomRef = currentRoom;
        const disconnectedId = socket.id;
        const disconnectedPlayer = roomRef.players.get(disconnectedId);

        if (disconnectedPlayer) {
          disconnectedPlayer._disconnected = true;
          roomRef.gameLog.push({ type: 'phase', message: `${disconnectedPlayer.name} 断线，等待重连...` });
          broadcastRoomState(roomRef, io);
        }

        session.disconnectTimer = setTimeout(() => {
          session.disconnectTimer = null;
          sessions.delete(sessionToken);
          const player = roomRef.players.get(disconnectedId);
          if (!player) return;
          delete player._disconnected;
          roomRef.players.delete(disconnectedId);

          if (roomRef.players.size === 0) { clearRoomTimer(roomRef); rooms.delete(roomRef.id); return; }
          if (roomRef.hostId === disconnectedId) roomRef.hostId = roomRef.players.keys().next().value;

          if (roomRef.phase === 'angelPick' && player.role === 'angel') {
            clearRoomTimer(roomRef);
            roomRef.phase = 'waiting';
            roomRef.gameLog.push({ type: 'phase', message: '天使已离开，游戏取消' });
            for (const [_, p] of roomRef.players) { p.role = null; p.word = null; p.alive = true; }
            broadcastRoomState(roomRef, io);
            return;
          }

          roomRef.gameLog.push({ type: 'phase', message: `${player.name} 断线超时，已移除` });
          if (!undercover.checkWinCondition(roomRef)) broadcastRoomState(roomRef, io);
        }, RECONNECT_GRACE);
      } else {
        const disconnectedPlayer = currentRoom.players.get(socket.id);
        currentRoom.players.delete(socket.id);
        if (currentRoom.players.size === 0) { clearRoomTimer(currentRoom); rooms.delete(currentRoom.id); return; }
        if (currentRoom.hostId === socket.id) currentRoom.hostId = currentRoom.players.keys().next().value;
        if (disconnectedPlayer) currentRoom.gameLog.push({ type: 'phase', message: `${disconnectedPlayer.name} 断线离开` });
        if (!undercover.checkWinCondition(currentRoom)) broadcastRoomState(currentRoom, io);
      }
    });
  });
}

module.exports = { registerSocketHandlers };
