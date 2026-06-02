// ============ 番剧人气对决 游戏逻辑 ============
// 两张番剧封面对决，所有玩家猜哪一部「评分人数（人气）」更高。
// 全房间共享同一套番剧池、同一出场顺序。每轮所有存活玩家做出选择后揭晓，
// 答对者按速度排名得分，答错（或超时未选）者扣 1 条命。
const { searchBangumiSubjects } = require('./bangumi');
const { broadcastRoomState, clearRoomTimer, setRoomTimer } = require('./room');
const { shuffle } = require('./utils');

const REVEAL_DURATION = 6; // 揭晓画面停留秒数

// 在整个排行区间内散布抽样，构建一个「多样化」的番剧池。
// 之前的做法是从单个随机 offset 连续取 limit 条，但 Bangumi 已按
// 排名/评分/热度排好序，连续的 50 条彼此数值非常接近 ——
// 于是「排名优先」总抽到同一分数、「热度优先」总抽到热度相似的作品。
// 这里改为把抽样窗口均匀铺开在排行区间，让池子同时包含高/中/低的作品。
async function buildDiversePool(baseOpts) {
  const targetSize = baseOpts.limit || 50;
  const chunkSize = 10;
  const numChunks = Math.max(2, Math.ceil(targetSize / chunkSize));

  const seen = new Set();
  const combined = [];
  const addAll = list => {
    for (const s of list) {
      if (s.name && !seen.has(s.name)) { seen.add(s.name); combined.push(s); }
    }
  };

  // 先取顶部一页（带轻微抖动），顺便拿到结果总数 total
  const firstOffset = Math.floor(Math.random() * chunkSize);
  const first = await searchBangumiSubjects({ ...baseOpts, limit: chunkSize, offset: firstOffset });
  const total = first.total || first.subjects.length;
  addAll(first.subjects);

  // 结果集本身就很小：直接整页取回即可，无需散布
  if (total <= targetSize) {
    const more = await searchBangumiSubjects({ ...baseOpts, limit: targetSize, offset: 0 });
    addAll(more.subjects);
    return combined;
  }

  // 把抽样窗口均匀铺开在排行区间（限定在前若干名以保证封面/数据质量），
  // 每个窗口再加一点随机抖动，避免每局都抽到完全相同的作品。
  const spread = Math.max(0, Math.min(total, Math.max(targetSize * 8, 400)) - chunkSize);
  const offsets = [];
  for (let i = 1; i < numChunks; i++) {
    const base = Math.round((spread * i) / (numChunks - 1));
    const jitter = Math.floor(Math.random() * chunkSize);
    offsets.push(Math.min(spread, base + jitter));
  }
  const pages = await Promise.all(
    offsets.map(off => searchBangumiSubjects({ ...baseOpts, limit: chunkSize, offset: off }))
  );
  for (const p of pages) addAll(p.subjects);

  return combined;
}

function aliveIds(room) {
  const rg = room.rankguess;
  return Array.from(room.players.keys()).filter(id => (rg.lives.get(id) || 0) > 0);
}

async function startGame(room, io) {
  room.phase = 'loading';
  broadcastRoomState(room, io);

  const baseOpts = room.dgBangumiOpts || { keyword: '', type: [2], sort: 'heat', limit: 50 };
  let subjects = await buildDiversePool(baseOpts);

  // 必须有封面图才能对决；人气数据缺失记为 0
  let withImage = subjects.filter(s => s.imageUrl);
  if (withImage.length < 2) withImage = subjects.filter(s => s.name); // 兜底

  if (withImage.length < 2) {
    room.phase = 'waiting';
    io.to(room.id).emit('chatMessage', { type: 'system', text: '错误：无法从Bangumi获取足够的番剧（至少需要2部带封面）。' });
    broadcastRoomState(room, io);
    return;
  }

  const rg = room.rankguess;
  rg.pool = shuffle(withImage);
  rg.poolIdx = 0;
  rg.roundNum = 0;
  rg.finished = false;
  rg.lastResult = null;
  rg.choices = new Map();
  rg.scores = new Map();
  rg.lives = new Map();
  const startLives = rg.startLives || 5;
  for (const [id] of room.players) {
    rg.scores.set(id, 0);
    rg.lives.set(id, startLives);
  }

  // 抽出前两张
  rg.left = rg.pool[rg.poolIdx++];
  rg.right = rg.pool[rg.poolIdx++];
  room.gameLog = [{ type: 'phase', message: '🔥 番剧人气对决开始！' }];

  beginRound(room, io);
}

function beginRound(room, io) {
  const rg = room.rankguess;
  rg.roundNum++;
  rg.choices = new Map();
  rg.roundStart = Date.now();
  room.phase = 'rankGuessing';

  setRoomTimer(room, rg.roundTimer || 20, () => {
    if (room.phase !== 'rankGuessing') return;
    resolveRound(room, io);
  });

  broadcastRoomState(room, io);
}

function handlePick(room, io, socketId, side) {
  const rg = room.rankguess;
  if (room.phase !== 'rankGuessing') return;
  if (side !== 'left' && side !== 'right') return;
  if (!room.players.has(socketId)) return;
  if ((rg.lives.get(socketId) || 0) <= 0) return; // 已出局
  if (rg.choices.has(socketId)) return; // 已选过，不可更改

  rg.choices.set(socketId, { side, time: Date.now() - rg.roundStart });

  const alive = aliveIds(room);
  const picked = alive.filter(id => rg.choices.has(id)).length;
  if (picked >= alive.length) {
    clearRoomTimer(room);
    resolveRound(room, io);
  } else {
    broadcastRoomState(room, io);
  }
}

function resolveRound(room, io) {
  const rg = room.rankguess;
  clearRoomTimer(room);

  const leftCount = rg.left?.ratingCount || 0;
  const rightCount = rg.right?.ratingCount || 0;
  // 人气更高者获胜，相等时以评分作为决胜
  let winnerSide;
  if (leftCount === rightCount) {
    const ls = rg.left?.score || 0, rs = rg.right?.score || 0;
    winnerSide = ls === rs ? 'tie' : (ls > rs ? 'left' : 'right');
  } else {
    winnerSide = leftCount > rightCount ? 'left' : 'right';
  }

  const alive = aliveIds(room);
  // 答对者按用时排序后分配速度分
  const correct = [];
  const wrong = [];
  for (const id of alive) {
    const choice = rg.choices.get(id);
    const isCorrect = choice && (winnerSide === 'tie' || choice.side === winnerSide);
    if (isCorrect) correct.push({ id, time: choice.time });
    else wrong.push(id);
  }
  correct.sort((a, b) => a.time - b.time);

  const results = [];
  correct.forEach((c, idx) => {
    const points = Math.max(100 - idx * 15, 25);
    rg.scores.set(c.id, (rg.scores.get(c.id) || 0) + points);
    results.push({ id: c.id, side: rg.choices.get(c.id).side, correct: true, points, lifeLost: false, timeMs: c.time });
  });
  for (const id of wrong) {
    const newLives = Math.max(0, (rg.lives.get(id) || 0) - 1);
    rg.lives.set(id, newLives);
    const choice = rg.choices.get(id);
    results.push({ id, side: choice ? choice.side : null, correct: false, points: 0, lifeLost: true, timeMs: choice ? choice.time : null });
  }

  rg.lastResult = {
    winnerSide,
    leftCount,
    rightCount,
    leftName: rg.left?.name,
    rightName: rg.right?.name,
    results,
  };

  room.phase = 'rankReveal';
  broadcastRoomState(room, io);

  // 揭晓后自动进入下一轮（或结束）
  setRoomTimer(room, REVEAL_DURATION, () => {
    advance(room, io);
  });
}

function advance(room, io) {
  const rg = room.rankguess;
  clearRoomTimer(room);

  // 所有玩家出局 → 结束
  if (aliveIds(room).length === 0) {
    endGame(room, io, '所有玩家都已出局');
    return;
  }
  // 番剧池抽完 → 结束
  if (rg.poolIdx >= rg.pool.length) {
    endGame(room, io, '所有番剧已抽完');
    return;
  }

  // 滑动窗口：右边留下成为新的左边，再抽一张作为新右边
  rg.left = rg.right;
  rg.right = rg.pool[rg.poolIdx++];
  rg.lastResult = null;
  beginRound(room, io);
}

function endGame(room, io, reason) {
  const rg = room.rankguess;
  clearRoomTimer(room);
  rg.finished = true;
  rg.lastResult = null;
  room.phase = 'rankEnded';
  const sorted = Array.from(rg.scores.entries()).sort((a, b) => b[1] - a[1]);
  const winnerName = room.players.get(sorted[0]?.[0])?.name || '?';
  room.gameLog.push({ type: 'phase', message: `🏆 对决结束（${reason}）！冠军：${winnerName}（${sorted[0]?.[1] || 0}分）` });
  broadcastRoomState(room, io);
}

function returnToLobby(room, io) {
  clearRoomTimer(room);
  room.phase = 'waiting';
  broadcastRoomState(room, io);
}

module.exports = { startGame, handlePick, returnToLobby, endGame };
