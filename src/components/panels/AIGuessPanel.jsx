import React, { useState, useRef, useEffect } from 'react';
import { useGame } from '../../context/GameContext';

export default function AIGuessPanel() {
  const { gameState, chatMessages, emit, isHost, myId } = useGame();
  const [msg, setMsg] = useState('');
  const chatRef = useRef(null);

  const phase = gameState?.phase;
  const aiguess = gameState?.aiguess;
  const players = gameState?.players || [];
  const isReveal = phase === 'aiguessReveal';

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  function send() {
    if (!msg.trim() || isReveal) return;
    emit('sendMessage', msg.trim());
    setMsg('');
  }

  function getPlayerName(id) {
    return players.find(p => p.id === id)?.name || id;
  }

  const scores = aiguess?.scores || [];
  const sortedScores = [...scores].sort((a, b) => b.score - a.score);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{isReveal ? '游戏结束' : 'AI猜番 (向AI提问猜番剧名)'}</h2>
        {aiguess && !isReveal && (
          <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            已猜对：{aiguess.guessedCount}/{aiguess.totalPlayers}
            {aiguess.isProcessing && ' · AI思考中…'}
          </span>
        )}
      </div>

      {isReveal && aiguess?.targetWord && (
        <div style={{ padding: '0.75rem 1rem', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: '1rem' }}>
          答案是：<strong>{aiguess.targetWord}</strong>
        </div>
      )}

      {sortedScores.length > 0 && (
        <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border)', fontSize: '0.85rem' }}>
          {sortedScores.map((s, i) => (
            <span key={s.id} style={{ marginRight: '1rem' }}>
              {i + 1}. {getPlayerName(s.id)} {s.score}分
            </span>
          ))}
        </div>
      )}

      <div className="chat-scroll" ref={chatRef}>
        {chatMessages.map((d, i) => {
          let theClass = 'chat-bubble';
          if (d.type === 'system') theClass += ' system';
          if (d.name === 'AI' || d.sender === 'AI') theClass += ' ai-msg';
          return (
            <div key={i} className={theClass}>
              {d.type !== 'system' && <span className="chat-name">{d.name || d.sender || ''}</span>}
              {' '}
              {d.message || d.text}
            </div>
          );
        })}
      </div>

      {!isReveal && (
        <div className="chat-bar">
          <input
            type="text" placeholder="向AI提问或猜测..." maxLength={200}
            value={msg} onChange={e => setMsg(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && send()}
            autoComplete="off"
          />
          <button className="btn btn-send" onClick={send}>↑</button>
        </div>
      )}

      {isHost && !isReveal && (
        <div style={{ padding: '0.5rem 1rem' }}>
          <button className="btn btn-ghost full-width" onClick={() => emit('aiguessEndGame')}>
            结束游戏（公布答案）
          </button>
        </div>
      )}

      {isHost && isReveal && (
        <div style={{ padding: '0.5rem 1rem' }}>
          <button className="btn btn-accent full-width" onClick={() => emit('aiguessReturnToLobby')}>
            返回大厅
          </button>
        </div>
      )}
    </section>
  );
}
