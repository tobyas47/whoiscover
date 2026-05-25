import React from 'react';
import { useGame } from '../../context/GameContext';

export default function DgEndPanel() {
  const { gameState, isHost, emit } = useGame();
  const players = gameState?.players || [];

  // Sort by score descending
  const sorted = [...players].sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🏆 游戏结束</h2>
      </div>
      <div className="dg-final-scores">
        {sorted.map((p, i) => (
          <div key={p.id} className={`dg-final-row ${i === 0 ? 'winner' : ''}`}>
            <span className="dg-rank">{i + 1}</span>
            <span className="dg-name">{p.name}</span>
            <span className="dg-score">{p.score || 0}分</span>
          </div>
        ))}
      </div>
      {isHost && (
        <button className="btn btn-accent full-width mt" onClick={() => emit('dgRestart')}>再来一局</button>
      )}
    </section>
  );
}
