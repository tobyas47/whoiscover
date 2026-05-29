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
  `你是一个海龟汤出题人。请根据番剧《${name}》中的某个核心情节，创作一道谜面。` +
  `严格要求：` +
  `①绝对不能出现番剧名、人物名、地名、种族名、技能名等任何专有名词；` +
  `②只描述"一个人做了某事/发生了某事"这样抽象的人类行为或结果，不描述世界观、背景设定；` +
  `③谜面读起来像一个奇怪的日常事件，而非明显的动漫剧情；` +
  `④不超过50字，越简短越好。` +
  `只输出谜面本身，不要任何解释或标题。`;

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
        systemInstruction: SYSTEM_INSTRUCTION + `\nThe target anime is: ${ts.targetWord}\nThe clue (谜面) shown to players is: ${ts.clue}`,
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
  broadcastRoomState(room, io);

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
      const pObj = room.players.get(socketId) || room.spectators?.get(socketId);
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
  broadcastRoomState(room, io);
}

function handleTurtleSoupMessage(room, socket, io, message) {
  if (room.phase !== 'turtleSoupGuessing') return false;
  const player = room.players.get(socket.id) || room.spectators?.get(socket.id);
  room.turtlesoup.processingQueue.push({ player, socketId: socket.id, message });
  processTurtleSoupQueue(room, io);
  return true;
}

async function startGame(room, io) {
  room.phase = 'loading';
  broadcastRoomState(room, io);

  const randomOffset = Math.floor(Math.random() * 200);
  const baseOpts = room.dgBangumiOpts || { keyword: '', type: [2], sort: 'rank', limit: 50 };
  const words = await fetchBangumiWords({ ...baseOpts, offset: randomOffset });
  if (words.length === 0) {
    room.phase = 'waiting';
    io.to(room.id).emit('chatMessage', { type: 'system', text: '错误：无法从Bangumi获取词库。' });
    broadcastRoomState(room, io);
    return;
  }

  if (!room.turtlesoup.usedWords) room.turtlesoup.usedWords = new Set();
  const unused = words.filter(w => !room.turtlesoup.usedWords.has(w));
  const pool = unused.length > 0 ? unused : words;
  const target = pool[Math.floor(Math.random() * pool.length)];
  const ts = room.turtlesoup;
  ts.usedWords.add(target);
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
