// ============ 房间管理 ============
const { MAX_LOG_ENTRIES } = require('./data');

const rooms = new Map();
const sessions = new Map();

function createRoom(hostId, hostName) {
  let roomId;
  do {
    roomId = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(roomId));
  const room = {
    id: roomId,
    hostId,
    mode: 'undercover',
    players: new Map(),
    phase: 'waiting',
    round: 0,
    settings: {
      undercoverCount: 1,
      angelCount: 0,
      blankCount: 0,
      wordSource: 'builtin',
      dayTimer: 120,
      nightTimer: 30,
      voteTimer: 30
    },
    goodWord: '',
    badWord: '',
    customWordPairs: [],
    customDgWords: [],
    angelWords: null,
    nightActions: new Map(),
    votes: new Map(),
    dayDiscussionOrder: [],
    currentSpeaker: 0,
    eliminatedTonight: [],
    gameLog: [],
    timer: null,
    timerEnd: null,
    spectators: new Map(),
    readyPlayers: new Set(),
    dgBangumiOpts: { keyword: '', type: [2], sort: 'rank', limit: 50 },
    dgWordSource: 'bangumi',
    aiguess: {
      history: [],
      targetWord: '',
      guessedPlayers: new Set(),
      scores: new Map(),
      processingQueue: [],
      isProcessing: false,
    },
    turtlesoup: {
      clue: '',
      targetWord: '',
      history: [],
      guessedPlayers: new Set(),
      scores: new Map(),
      processingQueue: [],
      isProcessing: false,
      usedWords: new Set(),
      qaLog: [],
      hintImageUrl: null,
      hintLevel: 0,
      targetYear: null,
      targetScore: null,
    },
    dg: {
      scores: new Map(),
      drawOrder: [],
      currentIdx: 0,
      currentWord: '',
      wordChoices: [],
      guessedPlayers: new Set(),
      roundNum: 1,
      maxRounds: 2,
      drawTimer: 80,
      strokes: [],
      usedWords: new Set()
    },
    _lastActivity: Date.now()
  };
  rooms.set(roomId, room);
  return room;
}

function getRoomState(room, playerId) {
  const players = [];
  for (const [id, p] of room.players) {
    players.push({
      id: p.id,
      name: p.name,
      alive: p.alive,
      role: id === playerId ? p.role : (room.phase === 'ended' ? p.role : undefined),
      word: id === playerId ? p.word : (room.phase === 'ended' ? p.word : undefined),
      score: room.dg.scores.get(id) || 0
    });
  }
  const state = {
    id: room.id,
    hostId: room.hostId,
    mode: room.mode,
    phase: room.phase,
    round: room.round,
    players,
    settings: room.settings,
    currentSpeaker: room.phase === 'day' ? room.dayDiscussionOrder[room.currentSpeaker] : null,
    gameLog: room.gameLog,
    timerEnd: room.timerEnd,
    blankGuessPlayer: room.blankGuessPlayer || null,
    readyCount: room.readyPlayers ? room.readyPlayers.size : 0,
    readyTotal: Array.from(room.players.values()).filter(p => p.alive).length,
    iReady: room.readyPlayers ? room.readyPlayers.has(playerId) : false
  };

  if (room.mode === 'aiguess') {
    state.aiguess = {
      guessedCount: room.aiguess.guessedPlayers.size,
      totalPlayers: room.players.size,
      isProcessing: room.aiguess.isProcessing,
      scores: Array.from(room.aiguess.scores.entries()).map(([id, s]) => ({ id, score: s })),
      targetWord: room.phase === 'aiguessReveal' ? room.aiguess.targetWord : undefined
    };
    state.dgBangumiOpts = room.dgBangumiOpts || null;
    state.dgWordSource = room.dgWordSource || 'bangumi';
  }

  if (room.mode === 'turtlesoup') {
    state.turtlesoup = {
      clue: room.turtlesoup.clue,
      guessedCount: room.turtlesoup.guessedPlayers.size,
      totalPlayers: room.players.size,
      isProcessing: room.turtlesoup.isProcessing,
      scores: Array.from(room.turtlesoup.scores.entries()).map(([id, s]) => ({ id, score: s })),
      targetWord: room.phase === 'turtleSoupReveal' ? room.turtlesoup.targetWord : undefined,
      qaLog: room.turtlesoup.qaLog || [],
      hintImageUrl: room.turtlesoup.hintImageUrl || null,
      hintLevel: room.turtlesoup.hintLevel || 0,
    };
    state.dgBangumiOpts = room.dgBangumiOpts || null;
    state.dgWordSource = room.dgWordSource || 'bangumi';
  }

  if (room.mode === 'drawguess') {
    const dg = room.dg;
    const isDrawer = dg.drawOrder[dg.currentIdx] === playerId;
    const drawerId = dg.drawOrder[dg.currentIdx] || null;
    const drawerPlayer = drawerId ? room.players.get(drawerId) : null;
    state.dg = {
      drawerId,
      drawerName: drawerPlayer ? drawerPlayer.name : '',
      currentDrawer: drawerId,
      isDrawer,
      currentWord: (isDrawer || room.phase === 'dgReveal') ? dg.currentWord : '',
      word: (isDrawer || room.phase === 'dgReveal') ? dg.currentWord : '',
      wordHint: dg.currentWord ? dg.currentWord.replace(/./g, '＿') : '',
      wordLength: dg.currentWord ? dg.currentWord.length : 0,
      wordChoices: isDrawer && room.phase === 'dgPicking' ? dg.wordChoices : [],
      guessedPlayers: Array.from(dg.guessedPlayers),
      roundNum: dg.roundNum,
      maxRounds: dg.maxRounds,
      drawTimer: dg.drawTimer,
      scores: Array.from(dg.scores.entries()).map(([id, s]) => ({ id, score: s })),
      wordSource: room.dgWordSource || 'builtin',
      bangumiOpts: room.dgBangumiOpts || null
    };
  }

  return state;
}

function broadcastRoomState(room, io) {
  room._lastActivity = Date.now();
  if (room.gameLog.length > MAX_LOG_ENTRIES) {
    room.gameLog = room.gameLog.slice(-MAX_LOG_ENTRIES);
  }
  for (const [socketId] of room.players) {
    io.to(socketId).emit('roomState', getRoomState(room, socketId));
  }
  const spectatorState = getRoomState(room, null);
  spectatorState.isSpectator = true;
  for (const [socketId] of room.spectators) {
    io.to(socketId).emit('roomState', spectatorState);
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

module.exports = {
  rooms,
  sessions,
  createRoom,
  getRoomState,
  broadcastRoomState,
  clearRoomTimer,
  setRoomTimer
};
