const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000
});

// ============ DOM ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const lobbyScreen = $('#lobby');
const roomScreen = $('#room');

let myId = null;
let isHost = false;
let isSpectator = false;
let currentPhase = '';
let nightActionSent = false;
let voteSent = false;
let timerInterval = null;

// ============ Session Persistence ============
function saveSession(token, roomId) {
  sessionStorage.setItem('gameSession', JSON.stringify({ token, roomId }));
}
function loadSession() {
  try { return JSON.parse(sessionStorage.getItem('gameSession')); } catch { return null; }
}
function clearSession() {
  sessionStorage.removeItem('gameSession');
}

// ============ Lobby ============
$('#btnCreate').addEventListener('click', () => {
  const name = $('#playerName').value.trim();
  if (!name) return shake($('#playerName'));
  socket.emit('createRoom', name, (res) => {
    if (res.success) {
      myId = socket.id;
      saveSession(res.token, res.roomId);
      enterRoom(res.roomId);
    }
  });
});

$('#btnJoinShow').addEventListener('click', () => {
  const panel = $('#joinPanel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) $('#roomIdInput').focus();
});

$('#btnJoin').addEventListener('click', joinRoom);
$('#roomIdInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') joinRoom(); });

function joinRoom() {
  const name = $('#playerName').value.trim();
  const roomId = $('#roomIdInput').value.trim();
  if (!name) return shake($('#playerName'));
  if (!roomId) return shake($('#roomIdInput'));
  socket.emit('joinRoom', { name, roomId }, (res) => {
    if (res.success) {
      myId = socket.id;
      if (res.spectator) isSpectator = true;
      if (res.token) saveSession(res.token, res.roomId);
      enterRoom(res.roomId);
    }
    else alert(res.error);
  });
}

function enterRoom(roomId) {
  lobbyScreen.classList.remove('active');
  roomScreen.classList.add('active');
  $('#displayRoomId').textContent = roomId;
  history.replaceState(null, '', '#' + roomId);
}

// 复制邀请链接
$('#btnCopyLink').addEventListener('click', () => {
  const url = location.origin + location.pathname + '#' + $('#displayRoomId').textContent;
  navigator.clipboard.writeText(url).then(() => {
    $('#btnCopyLink').textContent = '✓';
    setTimeout(() => $('#btnCopyLink').textContent = '🔗', 1500);
  });
});

// 自动加入：URL中有房间号时预填
(function autoJoinFromHash() {
  const hash = location.hash.slice(1).trim().toUpperCase();
  if (hash) {
    $('#roomIdInput').value = hash;
    $('#joinPanel').classList.remove('hidden');
  }
})();

// Rules toggle
$('#rulesToggle').addEventListener('click', () => {
  const body = $('#rulesBody');
  const header = $('#rulesToggle');
  body.classList.toggle('hidden');
  header.classList.toggle('open');
});

// ============ Settings ============
$('#btnStart').addEventListener('click', () => socket.emit('startGame'));
$('#settingUndercover').addEventListener('change', syncSettings);
$('#settingAngel').addEventListener('change', syncSettings);
$('#settingBlank').addEventListener('change', syncSettings);
$('#settingDayTimer').addEventListener('change', syncSettings);
$('#settingNightTimer').addEventListener('change', syncSettings);
$('#settingVoteTimer').addEventListener('change', syncSettings);
$('#settingWordSource').addEventListener('change', () => {
  syncSettings();
  // 显示/隐藏上传区域
  const src = $('#settingWordSource').value;
  $('#uploadArea').classList.toggle('hidden', src !== 'upload');
});

$('#wordFileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const data = JSON.parse(ev.target.result);
      socket.emit('uploadWords', data);
    } catch {
      alert('JSON文件格式错误');
    }
  };
  reader.readAsText(file);
});

socket.on('uploadWordsOk', (count) => {
  $('#uploadStatus').textContent = `✓ 已加载 ${count} 组词对`;
});

// ============ Angel Pick ============
$('#btnSubmitAngelWords').addEventListener('click', () => {
  const wordA = $('#angelWordA').value.trim();
  const wordB = $('#angelWordB').value.trim();
  if (!wordA || !wordB) return alert('请输入两个词');
  socket.emit('submitAngelWords', { wordA, wordB });
});

$('#btnSubmitBlankGuess').addEventListener('click', () => {
  const wordA = $('#blankGuessA').value.trim();
  const wordB = $('#blankGuessB').value.trim();
  if (!wordA || !wordB) return alert('请输入两个词');
  socket.emit('submitBlankGuess', { wordA, wordB });
  $('#btnSubmitBlankGuess').disabled = true;
});

function syncSettings() {
  socket.emit('updateSettings', {
    undercoverCount: +$('#settingUndercover').value,
    angelCount: +$('#settingAngel').value,
    blankCount: +$('#settingBlank').value,
    wordSource: $('#settingWordSource').value,
    dayTimer: +$('#settingDayTimer').value,
    nightTimer: +$('#settingNightTimer').value,
    voteTimer: +$('#settingVoteTimer').value
  });
}

// ============ Night ============
$('#btnSkipNight').addEventListener('click', () => {
  socket.emit('skipNight');
  nightActionSent = true;
  $('#btnSkipNight').disabled = true;
  $('#nightStatus').textContent = '已跳过，等待其他人...';
});

// ============ Chat ============
$('#btnSend').addEventListener('click', sendMsg);
$('#chatInput').addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMsg(); });

function sendMsg() {
  const input = $('#chatInput');
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit('sendMessage', msg);
  input.value = '';
}

$('#btnEndDiscussion').addEventListener('click', () => socket.emit('endDiscussion'));
$('#btnRestart').addEventListener('click', () => socket.emit('restartGame'));

// ============ Socket Events ============
socket.on('connect', () => {
  myId = socket.id;

  // 尝试断线重连
  const session = loadSession();
  if (session && session.token) {
    socket.emit('rejoinRoom', session.token, (res) => {
      if (res.success) {
        myId = socket.id;
        if (res.spectator) isSpectator = true;
        enterRoom(res.roomId);
      } else {
        // 重连失败，清除过期 session
        clearSession();
      }
    });
  }
});

socket.on('roomState', (state) => {
  if (state.isSpectator) isSpectator = true;
  isHost = state.hostId === myId;

  // 阶段变化时重置行动状态
  if (currentPhase !== state.phase) {
    nightActionSent = false;
    voteSent = false;
  }
  currentPhase = state.phase;

  // Night mode toggle
  document.body.classList.toggle('night', state.phase === 'night');

  render(state);
});

socket.on('nightActionConfirmed', () => {
  nightActionSent = true;
  $('#nightStatus').textContent = '✓ 已行动，等待他人...';
});

socket.on('nightProgress', (d) => {
  $('#nightStatus').textContent = `${d.acted} / ${d.total} 已行动`;
});

socket.on('voteProgress', (d) => {
  $('#voteStatus').textContent = `${d.voted} / ${d.total} 已投票`;
});

socket.on('chatMessage', (d) => {
  appendChat(d.name, d.message);
});

socket.on('error', (msg) => alert(msg));

// ============ Render ============
function render(state) {
  renderPhase(state);
  renderIdentity(state);
  renderPlayers(state);
  startCountdown(state.timerEnd);

  // 观战者标识
  document.body.classList.toggle('spectator-mode', isSpectator);

  // Hide all panels
  ['nightPanel','dayPanel','votePanel','waitingPanel','endPanel','angelPickPanel','blankGuessPanel'].forEach(id => {
    $(`#${id}`).classList.add('hidden');
  });

  if (isSpectator) {
    // 观战者只看日志和玩家列表
    $('#spectatorBadge').classList.remove('hidden');
    renderLog(state.gameLog);
    return;
  }
  $('#spectatorBadge').classList.add('hidden');

  switch (state.phase) {
    case 'waiting': renderWaiting(state); break;
    case 'angelPick': renderAngelPick(state); break;
    case 'night': renderNight(state); break;
    case 'day': renderDay(state); break;
    case 'vote': renderVote(state); break;
    case 'blankGuess': renderBlankGuess(state); break;
    case 'ended': renderEnd(state); break;
  }

  renderLog(state.gameLog);
}

function renderPhase(state) {
  const names = { waiting: '等待中', angelPick: '天使出词', night: '夜晚', day: '白天', vote: '投票', blankGuess: '白板猜词', ended: '结束' };
  const badge = $('#phaseBadge');
  badge.textContent = names[state.phase];
  badge.className = `phase-pill phase-${state.phase}`;
  $('#roundInfo').textContent = state.round > 0 ? `第${state.round}轮` : '';
}

function renderIdentity(state) {
  const me = state.players.find(p => p.id === myId);
  const card = $('#playerCard');
  if (me && me.role && state.phase !== 'waiting') {
    card.classList.remove('hidden');

    // 只有天使、白板、死亡、或游戏结束时才显示身份
    const showRole = me.role === 'angel' || me.role === 'blank' || !me.alive || state.phase === 'ended';
    const roleMapEnd = { good: '平民（好人）', undercover: '卧底', angel: '天使', blank: '白板' };
    const roleMapAlive = { angel: '天使', blank: '白板' };

    if (state.phase === 'ended') {
      $('#cardRole').textContent = roleMapEnd[me.role];
    } else if (showRole) {
      $('#cardRole').textContent = roleMapAlive[me.role] || me.role;
    } else {
      $('#cardRole').textContent = '';
    }
    $('#cardWord').textContent = me.word || '—';

    // 胜利条件提示
    const goalMap = {
      good: '🎯 找出拿到不同词的人，投票淘汰他们',
      undercover: '🎯 找出拿到不同词的人，投票淘汰他们',
      angel: '🎯 协助好人找出卧底（你能看到两个词）',
      blank: '🎯 活到最后，让好人和卧底全部死光'
    };
    $('#cardGoal').textContent = state.phase === 'ended' ? '' : goalMap[me.role];
  } else {
    card.classList.add('hidden');
  }
}

function renderPlayers(state) {
  const list = $('#playerList');
  list.innerHTML = '';
  state.players.forEach(p => {
    const chip = document.createElement('div');
    chip.className = 'player-chip';
    if (p.id === myId) chip.classList.add('is-me');
    if (!p.alive) chip.classList.add('is-dead');
    if (p.id === state.hostId) chip.classList.add('is-host');

    let status = p.alive ? '存活' : '已阵亡';
    if (state.phase === 'ended' && p.role) {
      const r = { good: '好人', undercover: '卧底', angel: '天使', blank: '白板' };
      status = r[p.role];
    }

    chip.innerHTML = `
      <div class="chip-name">${esc(p.name)}</div>
      <div class="chip-status">${status}</div>
    `;
    list.appendChild(chip);
  });
}

function renderWaiting(state) {
  $('#waitingPanel').classList.remove('hidden');
  if (isHost) {
    $('#settingsPanel').classList.remove('hidden');
    $('#waitingHint').classList.add('hidden');
    $('#settingUndercover').value = state.settings.undercoverCount;
    $('#settingAngel').value = state.settings.angelCount;
    $('#settingBlank').value = state.settings.blankCount;
    $('#settingWordSource').value = state.settings.wordSource;
    $('#uploadArea').classList.toggle('hidden', state.settings.wordSource !== 'upload');
    $('#settingDayTimer').value = state.settings.dayTimer;
    $('#settingNightTimer').value = state.settings.nightTimer;
    $('#settingVoteTimer').value = state.settings.voteTimer;
  } else {
    $('#settingsPanel').classList.add('hidden');
    $('#waitingHint').classList.remove('hidden');
  }
}

function renderAngelPick(state) {
  const me = state.players.find(p => p.id === myId);
  const panel = $('#angelPickPanel');
  panel.classList.remove('hidden');
  if (me && me.role === 'angel') {
    $('#angelPickInput').classList.remove('hidden');
    $('#angelPickWait').classList.add('hidden');
  } else {
    $('#angelPickInput').classList.add('hidden');
    $('#angelPickWait').classList.remove('hidden');
  }
}

function renderNight(state) {
  const me = state.players.find(p => p.id === myId);
  const panel = $('#nightPanel');
  panel.classList.remove('hidden');

  if (!me || !me.alive) {
    $('#nightTargets').innerHTML = '';
    $('#nightConfirmBar').classList.add('hidden');
    $('#nightStatus').textContent = '你已阵亡，静待天明...';
    $('#btnSkipNight').classList.add('hidden');
    return;
  }

  if (nightActionSent) {
    $('#nightTargets').innerHTML = '';
    $('#nightConfirmBar').classList.add('hidden');
    $('#nightStatus').textContent = '✓ 已行动，等待他人...';
    $('#btnSkipNight').disabled = true;
    $('#btnSkipNight').classList.remove('hidden');
    return;
  }
  $('#btnSkipNight').disabled = false;
  $('#btnSkipNight').classList.remove('hidden');
  $('#nightConfirmBar').classList.add('hidden');
  $('#nightStatus').textContent = '';

  let selectedNightTarget = null;

  const targets = $('#nightTargets');
  targets.innerHTML = '';
  state.players.forEach(p => {
    if (p.id === myId || !p.alive) return;
    const btn = document.createElement('button');
    btn.className = 'target-chip';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      if (nightActionSent) return;
      // 取消之前的选中
      targets.querySelectorAll('.target-chip').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedNightTarget = p.id;
      $('#nightConfirmBar').classList.remove('hidden');
    });
    targets.appendChild(btn);
  });

  // 确认按钮
  $('#btnNightConfirm').onclick = () => {
    if (!selectedNightTarget || nightActionSent) return;
    socket.emit('nightAction', selectedNightTarget);
    nightActionSent = true;
    $('#btnSkipNight').disabled = true;
    targets.querySelectorAll('.target-chip').forEach(b => b.disabled = true);
    $('#nightConfirmBar').classList.add('hidden');
  };

  // 取消按钮
  $('#btnNightCancel').onclick = () => {
    selectedNightTarget = null;
    targets.querySelectorAll('.target-chip').forEach(b => b.classList.remove('selected'));
    $('#nightConfirmBar').classList.add('hidden');
  };
}

function renderDay(state) {
  $('#dayPanel').classList.remove('hidden');
  const me = state.players.find(p => p.id === myId);

  if (isHost) $('#btnEndDiscussion').classList.remove('hidden');
  else $('#btnEndDiscussion').classList.add('hidden');

  const input = $('#chatInput');
  const send = $('#btnSend');
  if (!me || !me.alive) { input.disabled = true; send.disabled = true; }
  else { input.disabled = false; send.disabled = false; }
}

function renderVote(state) {
  const me = state.players.find(p => p.id === myId);
  const panel = $('#votePanel');
  panel.classList.remove('hidden');
  if (voteSent) {
    $('#voteTargets').innerHTML = '';
    $('#voteConfirmBar').classList.add('hidden');
    $('#btnAbstain').disabled = true;
    return;
  }
  $('#voteStatus').textContent = '';
  $('#voteConfirmBar').classList.add('hidden');

  if (!me || !me.alive) {
    $('#voteTargets').innerHTML = '';
    $('#btnAbstain').disabled = true;
    $('#voteStatus').textContent = '你已阵亡，无法投票';
    return;
  }

  let selectedVoteTarget = null;

  const targets = $('#voteTargets');
  targets.innerHTML = '';
  state.players.forEach(p => {
    if (p.id === myId || !p.alive) return;
    const btn = document.createElement('button');
    btn.className = 'target-chip';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      if (voteSent) return;
      targets.querySelectorAll('.target-chip').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedVoteTarget = p.id;
      $('#voteConfirmBar').classList.remove('hidden');
    });
    targets.appendChild(btn);
  });

  // 确认按钮
  $('#btnVoteConfirm').onclick = () => {
    if (!selectedVoteTarget || voteSent) return;
    socket.emit('vote', selectedVoteTarget);
    voteSent = true;
    targets.querySelectorAll('.target-chip').forEach(b => b.disabled = true);
    $('#voteConfirmBar').classList.add('hidden');
    $('#btnAbstain').disabled = true;
    $('#voteStatus').textContent = '✓ 已投票，等待他人...';
  };

  // 取消按钮
  $('#btnVoteCancel').onclick = () => {
    selectedVoteTarget = null;
    targets.querySelectorAll('.target-chip').forEach(b => b.classList.remove('selected'));
    $('#voteConfirmBar').classList.add('hidden');
  };

  // 弃权按钮
  $('#btnAbstain').disabled = false;
  $('#btnAbstain').onclick = () => {
    if (voteSent) return;
    socket.emit('vote', null);
    voteSent = true;
    targets.querySelectorAll('.target-chip').forEach(b => b.disabled = true);
    $('#voteConfirmBar').classList.add('hidden');
    $('#btnAbstain').disabled = true;
    $('#voteStatus').textContent = '✓ 已弃权，等待他人...';
  };
}

function renderBlankGuess(state) {
  const panel = $('#blankGuessPanel');
  panel.classList.remove('hidden');

  if (state.blankGuessPlayer === myId) {
    $('#blankGuessInput').classList.remove('hidden');
    $('#blankGuessWait').classList.add('hidden');
  } else {
    $('#blankGuessInput').classList.add('hidden');
    $('#blankGuessWait').classList.remove('hidden');
    $('#blankGuessWait').textContent = '等待白板猜词...';
  }
}

function renderEnd(state) {
  const panel = $('#endPanel');
  panel.classList.remove('hidden');

  const last = state.gameLog[state.gameLog.length - 1];
  $('#endMessage').textContent = last ? last.message : '游戏结束';

  const roles = $('#endRoles');
  roles.innerHTML = '';
  const rn = { good: '好人', undercover: '卧底', angel: '天使', blank: '白板' };
  state.players.forEach(p => {
    const row = document.createElement('div');
    row.className = 'end-row';
    row.innerHTML = `
      <span class="end-name">${esc(p.name)} ${p.alive ? '' : '💀'}</span>
      <span class="end-info">${rn[p.role] || '?'} · ${p.word || '无词'}</span>
    `;
    roles.appendChild(row);
  });

  if (isHost) $('#btnRestart').classList.remove('hidden');
  else $('#btnRestart').classList.add('hidden');
}

function renderLog(logs) {
  const html = (!logs || !logs.length)
    ? '<div class="log-line">暂无记录</div>'
    : logs.map(l => `<div class="log-line log-${l.type}">${esc(l.message)}</div>`).join('');
  const el = $('#logContent');
  const elD = $('#logContentDesktop');
  if (el) { el.innerHTML = html; el.scrollTop = el.scrollHeight; }
  if (elD) { elD.innerHTML = html; elD.scrollTop = elD.scrollHeight; }
}

function appendChat(name, message) {
  const box = $('#chatBox');
  const div = document.createElement('div');
  div.className = 'chat-bubble';
  div.innerHTML = `<span class="chat-author">${esc(name)}</span><span class="chat-text">${esc(message)}</span>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ============ Timer ============
function startCountdown(timerEnd) {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  const el = $('#countdown');
  if (!timerEnd) { el.classList.add('hidden'); return; }

  el.classList.remove('hidden');
  function tick() {
    const left = Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000));
    el.textContent = left + 's';
    if (left <= 10) el.classList.add('urgent');
    else el.classList.remove('urgent');
    if (left <= 0) { clearInterval(timerInterval); timerInterval = null; }
  }
  tick();
  timerInterval = setInterval(tick, 500);
}

// ============ Utilities ============
function esc(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => el.style.animation = '', 400);
}

// Inject shake keyframes
const style = document.createElement('style');
style.textContent = `@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }`;
document.head.appendChild(style);
