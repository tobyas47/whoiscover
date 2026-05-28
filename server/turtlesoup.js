const { fetchBangumiWords } = require('./bangumi');
const { broadcastRoomState } = require('./room');
const { GoogleGenAI } = require('@google/genai');

let aiClient;
try {
  aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.warn('GoogleGenAI init failed:', err.message);
}

const CLUE_MODEL = 'gemini-3.5-flash';
const ANSWER_MODEL = 'gemini-3.1-flash-lite';

const CLUE_PROMPT = (name) =>
  `请根据番剧《${name}》，用一两句话描述该番剧中某个场景、桥段或故事片段，作为谜面。` +
  `要求：绝对不能提及番剧名称、主角姓名或任何直接指向该番剧的独特术语；` +
  `描述要极度模糊，让人无法轻易联想到；越简短越好，不超过80字。只输出谜面本身，不要任何解释。`;

const SYSTEM_INSTRUCTION = `You are playing a guessing game called 海龟汤 (turtle soup).
A cryptic riddle about an anime was shown to players.
Players ask yes/no questions to guess the anime, or try to guess the exact anime name.
For questions or incorrect guesses, ONLY answer with one of: "是。" (Yes), "不是。" (No), "无法回答。" (Cannot answer).
Do NOT explain. Do NOT reveal the anime name.
If a player correctly guesses the exact anime name, call the end_game tool with their name.`;

async function generateClue(animeName) {
  if (!aiClient) return '（谜面生成失败）';
  try {
    const res = await aiClient.models.generateContent({
      model: CLUE_MODEL,
      contents: [{ role: 'user', parts: [{ text: CLUE_PROMPT(animeName) }] }],
    });
    return res.text?.trim() || '（谜面生成失败）';
  } catch (err) {
    console.error('TurtleSoup clue gen error:', err);
    return '（谜面生成失败）';
  }
}

async function getAIResponse(room, userMessage) {
  if (!aiClient) return { isCorrect: false, text: '无法回答。' };
  const ts = room.turtlesoup;
  const contents = [...ts.history, { role: 'user', parts: [{ text: userMessage }] }];
  try {
    const response = await aiClient.models.generateContent({
      model: ANSWER_MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION + `\nThe target anime is: ${ts.targetWord}`,
        tools: [{
          functionDeclarations: [{
            name: 'end_game',
            description: 'Call this ONLY when the user correctly guesses the exact target anime name.',
            parameters: {
              type: 'OBJECT',
              properties: { winnerName: { type: 'STRING', description: 'Name of the winner.' } },
              required: ['winnerName']
            }
          }]
        }]
      }
    });

    if (response.functionCalls?.length > 0) {
      const fc = response.functionCalls[0];
      if (fc.name === 'end_game') {
        const frPart = { name: fc.name, response: { result: 'Game Ended' }, id: fc.id };
        ts.history.push({ role: 'user', parts: [{ text: userMessage }] });
        ts.history.push({ role: 'model', parts: [{ functionCall: fc }] });
        ts.history.push({ role: 'user', parts: [{ functionResponse: frPart }] });
        return { isCorrect: true, text: '' };
      }
    }

    const text = response.text || '无法回答。';
    ts.history.push({ role: 'user', parts: [{ text: userMessage }] });
    ts.history.push({ role: 'model', parts: [{ text }] });
    return { isCorrect: false, text };
  } catch (err) {
    console.error('TurtleSoup AI error:', err);
    return { isCorrect: false, text: '无法回答。' };
  }
}

async function processTurtleSoupQueue(room, io) {
  const ts = room.turtlesoup;
  if (ts.isProcessing || ts.processingQueue.length === 0) return;
  ts.isProcessing = true;

  while (ts.processingQueue.length > 0) {
    const { player, socketId, message } = ts.processingQueue.shift();

    if (ts.guessedPlayers.has(socketId)) {
      io.to(socketId).emit('chatMessage', { type: 'system', text: '你已经猜对了，不能继续提问。' });
      continue;
    }

    io.to(room.id).emit('chatMessage', {
      type: 'chat',
      sender: player?.name || '玩家',
      text: message
    });

    const reply = await getAIResponse(room, message);

    if (reply.isCorrect) {
      ts.guessedPlayers.add(socketId);
      const pObj = room.players.get(socketId);
      const score = Math.max(100 - (ts.guessedPlayers.size - 1) * 20, 10);
      ts.scores.set(socketId, (ts.scores.get(socketId) || 0) + score);

      io.to(room.id).emit('chatMessage', {
        type: 'system',
        text: `🎉 ${pObj?.name || '玩家'} 猜对了！获得 ${score} 分`
      });

      if (ts.guessedPlayers.size >= room.players.size) {
        io.to(room.id).emit('chatMessage', {
          type: 'system',
          text: `全员猜对！游戏结束！答案是：${ts.targetWord}`
        });
        room.phase = 'turtleSoupReveal';
      }

      broadcastRoomState(room, io);
    } else {
      io.to(room.id).emit('chatMessage', {
        type: 'chat',
        sender: 'AI',
        text: `@${player?.name || '玩家'} ${reply.text}`
      });
    }
  }

  ts.isProcessing = false;
}

function handleTurtleSoupMessage(room, socket, io, message) {
  if (room.phase !== 'turtleSoupGuessing') return false;
  const player = room.players.get(socket.id);
  room.turtlesoup.processingQueue.push({ player, socketId: socket.id, message });
  processTurtleSoupQueue(room, io);
  return true;
}

async function startGame(room, io) {
  room.phase = 'loading';
  broadcastRoomState(room, io);

  const words = await fetchBangumiWords(room.dgBangumiOpts || { keyword: '', type: [2], sort: 'rank', limit: 50 });
  if (words.length === 0) {
    room.phase = 'waiting';
    io.to(room.id).emit('chatMessage', { type: 'system', text: '错误：无法从Bangumi获取词库。' });
    broadcastRoomState(room, io);
    return;
  }

  const target = words[Math.floor(Math.random() * words.length)];
  const ts = room.turtlesoup;
  ts.targetWord = target;
  ts.history = [];
  ts.clue = '';
  ts.guessedPlayers.clear();
  ts.scores.clear();
  ts.processingQueue = [];
  ts.isProcessing = false;

  io.to(room.id).emit('chatMessage', { type: 'system', text: 'AI正在生成谜面，请稍候...' });
  ts.clue = await generateClue(target);

  room.phase = 'turtleSoupGuessing';
  broadcastRoomState(room, io);
  io.to(room.id).emit('chatMessage', { type: 'system', text: '谜面已生成！可以向AI提问（回答是/否），或直接猜出番剧名！' });
}

function endRound(room, io) {
  room.phase = 'turtleSoupReveal';
  io.to(room.id).emit('chatMessage', { type: 'system', text: `游戏结束！答案是：${room.turtlesoup.targetWord}` });
  broadcastRoomState(room, io);
}

function returnToLobby(room, io) {
  room.phase = 'waiting';
  broadcastRoomState(room, io);
}

module.exports = { startGame, handleTurtleSoupMessage, endRound, returnToLobby };
