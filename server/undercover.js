// ============ 谁是卧底 游戏逻辑 ============
const { wordPairs } = require('./data');
const { broadcastRoomState, clearRoomTimer, setRoomTimer } = require('./room');

let io; // set via init()

function init(ioInstance) { io = ioInstance; }

function assignRoles(room) {
  const playerIds = Array.from(room.players.keys());
  const { undercoverCount, angelCount, blankCount } = room.settings;

  let pair;
  if (room.settings.wordSource === 'angel' && room.angelWords) {
    pair = [room.angelWords.wordA, room.angelWords.wordB];
  } else if (room.settings.wordSource === 'upload' && room.customWordPairs.length > 0) {
    pair = room.customWordPairs[Math.floor(Math.random() * room.customWordPairs.length)];
  } else {
    pair = wordPairs[Math.floor(Math.random() * wordPairs.length)];
  }

  if (Math.random() > 0.5) {
    room.goodWord = pair[0]; room.badWord = pair[1];
  } else {
    room.goodWord = pair[1]; room.badWord = pair[0];
  }

  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  let index = 0;

  for (let i = 0; i < undercoverCount && index < shuffled.length; i++, index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'undercover'; p.word = room.badWord;
  }
  for (let i = 0; i < angelCount && index < shuffled.length; i++, index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'angel';
    p.word = Math.random() > 0.5
      ? `词A: ${room.goodWord} / 词B: ${room.badWord}`
      : `词A: ${room.badWord} / 词B: ${room.goodWord}`;
  }
  for (let i = 0; i < blankCount && index < shuffled.length; i++, index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'blank'; p.word = '（无词）';
  }
  for (; index < shuffled.length; index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'good'; p.word = room.goodWord;
  }
}

function preAssignAngel(room) {
  const playerIds = Array.from(room.players.keys());
  const shuffled = [...playerIds].sort(() => Math.random() - 0.5);
  const { undercoverCount, angelCount, blankCount } = room.settings;

  for (const [_, p] of room.players) { p.role = null; p.word = null; p.alive = true; }

  let index = 0;
  for (let i = 0; i < undercoverCount && index < shuffled.length; i++, index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'undercover'; p.word = '等待天使出词...';
  }
  for (let i = 0; i < angelCount && index < shuffled.length; i++, index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'angel'; p.word = '请出两个相似的词';
  }
  for (let i = 0; i < blankCount && index < shuffled.length; i++, index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'blank'; p.word = '（无词）';
  }
  for (; index < shuffled.length; index++) {
    const p = room.players.get(shuffled[index]);
    p.role = 'good'; p.word = '等待天使出词...';
  }
}

function finishAngelPick(room) {
  const pair = [room.angelWords.wordA, room.angelWords.wordB];
  if (Math.random() > 0.5) {
    room.goodWord = pair[0]; room.badWord = pair[1];
  } else {
    room.goodWord = pair[1]; room.badWord = pair[0];
  }

  for (const [_, p] of room.players) {
    switch (p.role) {
      case 'good': p.word = room.goodWord; break;
      case 'undercover': p.word = room.badWord; break;
      case 'angel':
        p.word = Math.random() > 0.5
          ? `词A: ${room.goodWord} / 词B: ${room.badWord}`
          : `词A: ${room.badWord} / 词B: ${room.goodWord}`;
        break;
      case 'blank': p.word = '（无词）'; break;
    }
  }

  room.gameLog.push({ type: 'phase', message: '天使已出词，游戏开始！' });
  room.round = 1;
  startDayPhase(room);
}

function startNightPhase(room) {
  room.phase = 'night';
  room.nightActions.clear();
  room.eliminatedTonight = [];
  room.gameLog.push({ type: 'phase', message: `第 ${room.round} 夜晚开始` });

  setRoomTimer(room, room.settings.nightTimer, () => {
    if (room.phase !== 'night') return;
    const alivePlayers = Array.from(room.players.entries()).filter(([_, p]) => p.alive);
    for (const [id] of alivePlayers) {
      if (!room.nightActions.has(id)) room.nightActions.set(id, null);
    }
    resolveNight(room);
  });

  broadcastRoomState(room, io);
}

function resolveNight(room) {
  if (room.phase !== 'night') return; // guard against double-call
  clearRoomTimer(room);
  const killed = new Set();
  const suicided = new Set();

  for (const [actorId, targetId] of room.nightActions) {
    const actor = room.players.get(actorId);
    if (!actor || !actor.alive || !targetId) continue;
    if (actor.role === 'good' || actor.role === 'angel' || actor.role === 'blank') {
      suicided.add(actorId);
    } else if (actor.role === 'undercover') {
      killed.add(targetId);
    }
  }

  for (const id of killed) { const p = room.players.get(id); if (p) p.alive = false; }
  for (const id of suicided) { const p = room.players.get(id); if (p) p.alive = false; }
  room.eliminatedTonight = [...killed, ...suicided];

  for (const id of room.eliminatedTonight) {
    const p = room.players.get(id);
    if (p) room.gameLog.push({ type: 'night', message: `${p.name} 在夜晚中死去` });
  }

  if (checkWinCondition(room)) return;

  room.round++;
  startDayPhase(room);
}

function startDayPhase(room) {
  room.phase = 'day';
  room.readyPlayers = new Set();
  room.votes.clear();
  const alivePlayers = Array.from(room.players.entries()).filter(([_, p]) => p.alive).map(([id]) => id);
  if (alivePlayers.length === 0) {
    checkWinCondition(room);
    return;
  }
  room.dayDiscussionOrder = alivePlayers.sort(() => Math.random() - 0.5);
  room.currentSpeaker = 0;

  if (room.round > 1) {
    room.gameLog.push({
      type: 'phase',
      message: room.eliminatedTonight.length === 0 ? '天亮了，昨晚是平安夜' : '天亮了，请查看昨晚情况'
    });
  }
  room.gameLog.push({ type: 'phase', message: '白天讨论阶段开始，请自由发言' });

  setRoomTimer(room, room.settings.dayTimer, () => {
    if (room.phase !== 'day') return;
    if (room.round === 1) {
      room.gameLog.push({ type: 'phase', message: '讨论时间结束，进入夜晚' });
      startNightPhase(room);
    } else {
      startVotePhase(room);
    }
  });

  broadcastRoomState(room, io);
}

function startVotePhase(room) {
  clearRoomTimer(room);
  room.phase = 'vote';
  room.votes.clear();
  room.gameLog.push({ type: 'phase', message: '投票阶段开始' });

  setRoomTimer(room, room.settings.voteTimer, () => {
    if (room.phase !== 'vote') return;
    resolveVote(room);
  });

  broadcastRoomState(room, io);
}

function resolveVote(room) {
  if (room.phase !== 'vote') return; // guard against double-call
  clearRoomTimer(room);
  const voteCount = new Map();
  for (const [_, targetId] of room.votes) {
    if (targetId === null) continue;
    voteCount.set(targetId, (voteCount.get(targetId) || 0) + 1);
  }

  let maxVotes = 0, maxTargets = [];
  for (const [targetId, count] of voteCount) {
    if (count > maxVotes) { maxVotes = count; maxTargets = [targetId]; }
    else if (count === maxVotes) maxTargets.push(targetId);
  }

  if (maxTargets.length === 1 && maxVotes > 0) {
    const eliminated = room.players.get(maxTargets[0]);
    if (eliminated) {
      eliminated.alive = false;
      room.gameLog.push({ type: 'vote', message: `${eliminated.name} 被投票淘汰了（${maxVotes}票）` });

      const undercoverAlive = Array.from(room.players.values()).filter(p => p.alive && p.role === 'undercover');
      if (eliminated.role === 'blank' && undercoverAlive.length === 0) {
        room.phase = 'blankGuess';
        room.blankGuessPlayer = maxTargets[0];
        clearRoomTimer(room);
        room.gameLog.push({ type: 'phase', message: `${eliminated.name} 是白板！可以猜词翻盘！` });
        setRoomTimer(room, 60, () => {
          if (room.phase !== 'blankGuess') return;
          room.gameLog.push({ type: 'end', message: '⏱ 白板猜词超时，好人阵营胜利！' });
          room.phase = 'ended';
          broadcastRoomState(room, io);
        });
        broadcastRoomState(room, io);
        return;
      }
    }
  } else {
    room.gameLog.push({ type: 'vote', message: '平票，无人被淘汰' });
  }

  if (checkWinCondition(room)) return;
  startNightPhase(room);
}

function checkWinCondition(room) {
  const alive = Array.from(room.players.values()).filter(p => p.alive);
  const undercoverAlive = alive.filter(p => p.role === 'undercover');
  const blankAlive = alive.filter(p => p.role === 'blank');
  const goodAlive = alive.filter(p => p.role === 'good' || p.role === 'angel');

  if (blankAlive.length > 0 && undercoverAlive.length === 0 && goodAlive.length === 0) {
    room.phase = 'ended'; clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '🃏 白板胜利！好人和卧底全军覆没！' });
    broadcastRoomState(room, io); return true;
  }
  if (undercoverAlive.length > 0 && undercoverAlive.length >= alive.length - undercoverAlive.length) {
    room.phase = 'ended'; clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '😈 卧底阵营胜利！卧底人数已不少于其他玩家！' });
    broadcastRoomState(room, io); return true;
  }
  if (undercoverAlive.length === 0 && blankAlive.length === 0 && goodAlive.length > 0) {
    room.phase = 'ended'; clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '🎉 好人阵营胜利！卧底和白板已全部淘汰！' });
    broadcastRoomState(room, io); return true;
  }
  if (alive.length === 0) {
    room.phase = 'ended'; clearRoomTimer(room);
    room.gameLog.push({ type: 'end', message: '💀 全军覆没！无人生还，平局！' });
    broadcastRoomState(room, io); return true;
  }
  return false;
}

module.exports = {
  init,
  assignRoles,
  preAssignAngel,
  finishAngelPick,
  startNightPhase,
  resolveNight,
  startDayPhase,
  startVotePhase,
  resolveVote,
  checkWinCondition
};
