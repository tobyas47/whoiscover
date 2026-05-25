import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';

export default function NightPanel() {
  const { gameState, myId, emit, isSpectator } = useGame();
  const [selected, setSelected] = useState(null);
  const [sent, setSent] = useState(false);
  const [progress, setProgress] = useState('');

  // Reset local state on re-entry to night phase
  useEffect(() => {
    setSelected(null);
    setSent(false);
    setProgress('');
  }, [gameState?.round]);

  const players = gameState?.players?.filter(p => p.alive && p.id !== myId) || [];
  const me = gameState?.players?.find(p => p.id === myId);

  // Listen for progress via gameState
  React.useEffect(() => {
    const socket = window.__gameSocket;
    if (!socket) return;
    const handler = (d) => setProgress(`${d.acted} / ${d.total} 已行动`);
    socket.on('nightProgress', handler);
    return () => socket.off('nightProgress', handler);
  }, []);

  function handleConfirm() {
    if (!selected) return;
    emit('nightAction', { targetId: selected });
    setSent(true);
  }

  function handleSkip() {
    emit('skipNight');
    setSent(true);
  }

  if (isSpectator || !me?.alive) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>夜幕降临</h2></div>
        <p className="progress-hint">等待玩家行动...</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>夜幕降临</h2>
        <p className="panel-hint danger">好人阵营刀人将导致自己死亡</p>
      </div>

      {!sent ? (
        <>
          <div className="target-grid">
            {players.map(p => (
              <button
                key={p.id}
                className={`target-btn ${selected === p.id ? 'selected' : ''}`}
                onClick={() => setSelected(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          {selected && (
            <div className="confirm-bar">
              <button className="btn btn-accent" onClick={handleConfirm}>确认动刀</button>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>取消</button>
            </div>
          )}
          <div className="panel-foot">
            <button className="btn btn-ghost full-width" onClick={handleSkip}>不行动</button>
          </div>
        </>
      ) : (
        <p className="progress-hint">✓ 已行动，等待他人... {progress}</p>
      )}
    </section>
  );
}
