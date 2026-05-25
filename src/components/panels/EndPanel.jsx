import React from 'react';
import { useGame } from '../../context/GameContext';

export default function EndPanel() {
  const { gameState, isHost, emit } = useGame();
  const roleLabels = { good: '好人', undercover: '卧底', angel: '天使', blank: '白板' };

  const lastEndLog = gameState?.gameLog?.filter(e => e.type === 'end').pop();

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{lastEndLog?.message || '游戏结束'}</h2>
      </div>
      <div className="end-reveal">
        {gameState?.players?.map(p => (
          <div key={p.id} className={`end-role-card ${p.role}`}>
            <div className="end-name">{p.name}</div>
            <div className="end-role">{roleLabels[p.role] || p.role}</div>
            {p.word && <div className="end-word">{p.word}</div>}
          </div>
        ))}
      </div>
      {isHost && (
        <button className="btn btn-accent full-width mt" onClick={() => emit('restartGame')}>再来一局</button>
      )}
    </section>
  );
}
