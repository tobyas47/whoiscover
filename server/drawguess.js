// ============ 你画我猜 游戏逻辑 ============
const { drawGuessWords } = require('./data');
const { fetchBangumiWords } = require('./bangumi');
const { broadcastRoomState, clearRoomTimer, setRoomTimer } = require('./room');
const { shuffle } = require('./utils');

let io;

function init(ioInstance) { io = ioInstance; }

function dgPickRandomWords(room, count = 3) {
  const pool = room.dgWordPool && room.dgWordPool.length > 0
    ? room.dgWordPool
    : (room.customDgWords.length > 0 ? room.customDgWords : drawGuessWords);
  return shuffle(pool).slice(0, count);
}

function dgStartGame(room) {
  const dg = room.dg;
  dg.scores = new Map();
  dg.drawOrder = shuffle(Array.from(room.players.keys()));
  dg.currentIdx = 0;
  dg.roundNum = 1;
  dg.guessedPlayers = new Set();
  dg.strokes = [];
  dg.currentWord = '';
  for (const [id] of room.players) dg.scores.set(id, 0);
  room.gameLog = [{ type: 'phase', message: '🎨 你画我猜开始！' }];

  // 如果选了 Bangumi 词源，先异步拉词再开始
  if (room.dgWordSource === 'bangumi' && room.dgBangumiOpts) {
    const fallbackTimeout = setTimeout(() => {
      if (room.phase !== 'dgPicking') {
        room.dgWordPool = [];
        room.gameLog.push({ type: 'system', message: 'Bangumi词库获取超时，使用默认词库' });
        dgStartPicking(room);
      }
    }, 8000);

    fetchBangumiWords(room.dgBangumiOpts).then(words => {
      clearTimeout(fallbackTimeout);
      room.dgWordPool = words.length >= 3 ? words : [];
      if (room.dgWordPool.length === 0) {
        room.gameLog.push({ type: 'system', message: 'Bangumi词库获取失败，使用默认词库' });
      }
      dgStartPicking(room);
    }).catch(err => {
      clearTimeout(fallbackTimeout);
      console.error('Bangumi fetch error:', err);
      room.dgWordPool = [];
      room.gameLog.push({ type: 'system', message: 'Bangumi词库获取出错，使用默认词库' });
      dgStartPicking(room);
    });
  } else {
    room.dgWordPool = [];
    dgStartPicking(room);
  }
}

function dgStartPicking(room) {
  const dg = room.dg;
  room.phase = 'dgPicking';
  dg.wordChoices = dgPickRandomWords(room, 3);
  dg.currentWord = '';
  dg.guessedPlayers = new Set();
  dg.strokes = [];

  const drawerName = room.players.get(dg.drawOrder[dg.currentIdx])?.name || '?';
  room.gameLog.push({ type: 'phase', message: `轮到 ${drawerName} 画画，正在选词...` });

  setRoomTimer(room, 15, () => {
    if (room.phase !== 'dgPicking') return;
    dg.currentWord = dg.wordChoices[0];
    dgStartDrawing(room);
  });

  broadcastRoomState(room, io);
}

function dgStartDrawing(room) {
  const dg = room.dg;
  room.phase = 'dgDrawing';
  dg.strokes = [];

  // Notify all clients to clear their canvas for the new turn
  io.to(room.id).emit('dgNewTurn');

  const drawerName = room.players.get(dg.drawOrder[dg.currentIdx])?.name || '?';
  room.gameLog.push({ type: 'phase', message: `${drawerName} 开始画画！(${dg.currentWord.length}个字)` });

  setRoomTimer(room, dg.drawTimer, () => {
    if (room.phase !== 'dgDrawing') return;
    dgEndTurn(room);
  });

  broadcastRoomState(room, io);
}

function dgEndTurn(room) {
  if (room.phase !== 'dgDrawing') return; // guard against double-call
  clearRoomTimer(room);
  const dg = room.dg;
  room.phase = 'dgReveal';
  room.gameLog.push({ type: 'phase', message: `答案是：${dg.currentWord}` });

  setRoomTimer(room, 3, () => { dgNextTurn(room); });
  broadcastRoomState(room, io);
}

function dgNextTurn(room) {
  const dg = room.dg;
  dg.currentIdx++;

  if (dg.currentIdx >= dg.drawOrder.length) {
    dg.currentIdx = 0;
    dg.roundNum++;
    if (dg.roundNum > dg.maxRounds) { dgEndGame(room); return; }
    dg.drawOrder = shuffle(dg.drawOrder);
    room.gameLog.push({ type: 'phase', message: `第 ${dg.roundNum} 轮开始！` });
  }

  dgStartPicking(room);
}

function dgEndGame(room) {
  room.phase = 'dgEnded';
  clearRoomTimer(room);
  const sorted = Array.from(room.dg.scores.entries()).sort((a, b) => b[1] - a[1]);
  const winnerName = room.players.get(sorted[0]?.[0])?.name || '?';
  room.gameLog.push({ type: 'phase', message: `🏆 游戏结束！冠军：${winnerName}（${sorted[0]?.[1]}分）` });
  broadcastRoomState(room, io);
}

function dgHandleGuess(room, socketId, text) {
  const dg = room.dg;
  if (room.phase !== 'dgDrawing') return false;
  if (socketId === dg.drawOrder[dg.currentIdx]) return false;
  if (dg.guessedPlayers.has(socketId)) return false;

  const player = room.players.get(socketId);
  if (!player) return false;

  const guess = text.trim().toLowerCase();
  const answer = dg.currentWord.toLowerCase();

  if (guess === answer) {
    dg.guessedPlayers.add(socketId);
    const totalGuessers = room.players.size - 1;
    const guessScore = Math.max(10, 50 - (dg.guessedPlayers.size - 1) * 10);
    const drawScore = 10;

    dg.scores.set(socketId, (dg.scores.get(socketId) || 0) + guessScore);
    const drawerId = dg.drawOrder[dg.currentIdx];
    dg.scores.set(drawerId, (dg.scores.get(drawerId) || 0) + drawScore);

    room.gameLog.push({ type: 'correct', message: `${player.name} 猜对了！+${guessScore}分` });

    if (dg.guessedPlayers.size >= totalGuessers) {
      dgEndTurn(room);
    } else {
      broadcastRoomState(room, io);
    }
    return true;
  }
  return false;
}

module.exports = {
  init,
  dgStartGame,
  dgStartPicking,
  dgStartDrawing,
  dgEndTurn,
  dgNextTurn,
  dgEndGame,
  dgHandleGuess
};
