const { fetchBangumiWords } = require('./bangumi');
const { broadcastRoomState } = require('./room');
const { GoogleGenAI } = require('@google/genai');

let aiClient;
try {
  aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
} catch (err) {
  console.warn('GoogleGenAI init failed:', err.message);
}

const SYSTEM_INSTRUCTION = `You are playing a guessing game.
You have selected an anime (bangumi).
Players will ask you yes/no questions to guess it, or they will try to guess the exact anime name.
If a player asks a question or an incorrect guess, you MUST ONLY answer with exactly one of these three phrases: "是。" (Yes), "不是。" (No), or "无法回答。" (Cannot answer).
Do NOT explain. Do NOT add punctuation unless specified. Do NOT reveal the anime.
If a player's query correctly guesses the target anime name, you MUST use the end_game tool and provide the winner. They don't need to guess the full name, as long as it's clear enough to identify the anime. For example, if the target anime is "进击的巨人" and the player guesses "巨人", you can consider it correct and end the game. They also don't need to guess the correct season.`;

async function getAIResponse(room, userMessage) {
  if (!aiClient) return { isCorrect: false, text: "无法回答。" };

  // Clone history
  const contents = [...room.aiguess.history];
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

  try {
    const response = await aiClient.models.generateContent({
      model: 'gemini-3.1-flash-lite',
      contents: contents,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION +
          `\nThe target anime is: ${room.aiguess.targetWord}` +
          (room.aiguess.targetYear ? `\nYear: ${room.aiguess.targetYear}` : '') +
          (room.aiguess.targetScore ? `\nBangumi score: ${room.aiguess.targetScore}` : ''),
        tools: [{
          functionDeclarations: [{
            name: "end_game",
            description: "Call this function ONLY when the user correctly guesses the exact target anime name to end the game.",
            parameters: {
              type: "OBJECT",
              properties: {
                winnerName: {
                  type: "STRING",
                  description: "The name of the user who guessed correctly."
                }
              },
              required: ["winnerName"]
            }
          }]
        }]
      }
    });

    if (response.functionCalls && response.functionCalls.length > 0) {
      const functionCall = response.functionCalls[0];
      if (functionCall.name === "end_game") {
        const functionResponsePart = {
          name: functionCall.name,
          response: { result: "Game Ended" },
          id: functionCall.id
        };
        room.aiguess.history.push({ role: 'user', parts: [{ text: userMessage }] });
        room.aiguess.history.push({ role: 'model', parts: [{ functionCall }] });
        room.aiguess.history.push({ role: 'user', parts: [{ functionResponse: functionResponsePart }] });
        return { isCorrect: true, text: "" };
      }
    }

    const text = response.text || "无法回答。";

    room.aiguess.history.push({ role: 'user', parts: [{ text: userMessage }] });
    room.aiguess.history.push({ role: 'model', parts: [{ text }] });

    return { isCorrect: false, text };
  } catch (err) {
    console.error('AI error:', err);
    return { isCorrect: false, text: "无法回答。" };
  }
}

// Process chat messages sequentially
async function processAIGuessQueue(room, io) {
  if (room.aiguess.isProcessing || room.aiguess.processingQueue.length === 0) return;
  room.aiguess.isProcessing = true;

  while (room.aiguess.processingQueue.length > 0) {
    const { player, socketId, message } = room.aiguess.processingQueue.shift();

    // Player already guessed correctly — notify them privately and skip
    if (room.aiguess.guessedPlayers.has(socketId)) {
      io.to(socketId).emit('chatMessage', {
        type: 'system',
        text: '你已经猜对了，不能继续提问。'
      });
      continue;
    }

    // Broadcast user's message to the room
    io.to(room.id).emit('chatMessage', {
      type: 'chat',
      sender: player ? player.name : '玩家',
      text: message
    });

    // Get AI answer
    const replyInfo = await getAIResponse(room, message);

    if (replyInfo.isCorrect) {
      room.aiguess.guessedPlayers.add(socketId);
      const pObj = room.players.get(socketId);
      const score = Math.max(100 - (room.aiguess.guessedPlayers.size - 1) * 20, 10);
      room.aiguess.scores.set(socketId, (room.aiguess.scores.get(socketId) || 0) + score);

      io.to(room.id).emit('chatMessage', {
        type: 'system',
        text: `🎉 ${pObj ? pObj.name : '玩家'} 猜对了！获得 ${score} 分`
      });

      // End game when all players have guessed
      if (room.aiguess.guessedPlayers.size >= room.players.size) {
        io.to(room.id).emit('chatMessage', {
          type: 'system',
          text: `全员猜对！游戏结束！答案是：${room.aiguess.targetWord}`
        });
        room.phase = 'aiguessReveal';
      }

      broadcastRoomState(room, io);
    } else {
      io.to(room.id).emit('chatMessage', {
        type: 'chat',
        sender: 'AI',
        text: `@${player ? player.name : '玩家'} ${replyInfo.text}`
      });
    }
  }

  room.aiguess.isProcessing = false;
}

function handleAIGuessMessage(room, socket, io, message) {
  if (room.phase !== 'aiGuessing') {
    return false; // not handled
  }

  const player = room.players.get(socket.id);

  room.aiguess.processingQueue.push({ player, socketId: socket.id, message });
  processAIGuessQueue(room, io);

  return true; // handled
}

async function startGame(room, io) {
  room.phase = 'loading';
  broadcastRoomState(room, io);

  const baseOpts = room.dgBangumiOpts || { keyword: '', type: [2], sort: 'rank', limit: 50 };
  const randomOffset = Math.floor(Math.random() * Math.max(200, (baseOpts.limit || 50) * 3));
  const subjects = await fetchBangumiWords({ ...baseOpts, offset: randomOffset });
  if (subjects.length === 0) {
    room.phase = 'waiting';
    io.to(room.id).emit('chatMessage', { type: 'system', text: '错误：无法从Bangumi获取词库。' });
    broadcastRoomState(room, io);
    return;
  }

  const picked = subjects[Math.floor(Math.random() * subjects.length)];
  room.aiguess.targetWord = picked.name;
  room.aiguess.targetYear = picked.year || null;
  room.aiguess.targetScore = picked.score || null;
  room.aiguess.history = [];
  room.aiguess.guessedPlayers.clear();
  room.aiguess.scores.clear();
  room.aiguess.processingQueue = [];
  room.aiguess.isProcessing = false;

  room.phase = 'aiGuessing';
  io.to(room.id).emit('chatMessage', { type: 'system', text: `游戏开始！AI已经选择了一部番剧，大家开始提问吧！` });
  broadcastRoomState(room, io);
}

function endRound(room, io) {
  room.phase = 'aiguessReveal';
  io.to(room.id).emit('chatMessage', { type: 'system', text: `游戏结束！答案是：${room.aiguess.targetWord}` });
  broadcastRoomState(room, io);
}

function returnToLobby(room, io) {
  room.phase = 'waiting';
  broadcastRoomState(room, io);
}

module.exports = {
  startGame,
  handleAIGuessMessage,
  endRound,
  returnToLobby
};
