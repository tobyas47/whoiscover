import React, { useState, useEffect } from 'react';
import { useGame } from '../context/GameContext';

export default function RoomHeader() {
  const { roomId, gameState, isHost, isSpectator, emit } = useGame();
  const phase = gameState?.phase || 'waiting';
  const [timeLeft, setTimeLeft] = useState(null);
  const [copied, setCopied] = useState(false);

  // Countdown
  useEffect(() => {
    if (!gameState?.timerEnd) { setTimeLeft(null); return; }
    const tick = () => {
      const left = Math.max(0, Math.ceil((gameState.timerEnd - Date.now()) / 1000));
      setTimeLeft(left > 0 ? left : null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [gameState?.timerEnd]);

  const phaseLabels = {
    waiting: '等待中', angelPick: '天使出词', night: '夜晚',
    day: '讨论', vote: '投票', blankGuess: '白板猜词',
    ended: '结算',
    dgPicking: '选词', dgDrawing: '画画', dgReveal: '揭晓', dgEnded: '结算'
  };

  function copyLink() {
    const url = location.origin + location.pathname + '#' + roomId;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <header className="room-bar">
      <div className="room-bar-left">
        <span className="room-code">{roomId}</span>
        {gameState?.round && <span className="room-round">第{gameState.round}轮</span>}
        <button className="btn-copy" onClick={copyLink} title="复制邀请链接">
          {copied ? '✓' : '🔗'}
        </button>
      </div>
      <div className="room-bar-right">
        {isHost && phase !== 'waiting' && (
          <button className="btn btn-sm btn-danger" onClick={() => { if (confirm('确定要重新开始游戏吗？')) { emit('restartGame'); } }}>
            ↻ 重开
          </button>
        )}
        {isSpectator && <span className="spectator-badge">👁 观战中</span>}
        <div className="phase-pill">{phaseLabels[phase] || phase}</div>
        {timeLeft !== null && <div className="countdown">{timeLeft}s</div>}
      </div>
    </header>
  );
}
