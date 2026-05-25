import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';

export default function VotePanel() {
  const { gameState, myId, emit, isSpectator } = useGame();
  const [selected, setSelected] = useState(null);
  const [sent, setSent] = useState(false);
  const [progress, setProgress] = useState('');

  // Reset local state on re-entry to vote phase
  useEffect(() => {
    setSelected(null);
    setSent(false);
    setProgress('');
  }, [gameState?.round]);

  const players = gameState?.players?.filter(p => p.alive && p.id !== myId) || [];
  const me = gameState?.players?.find(p => p.id === myId);

  React.useEffect(() => {
    const socket = window.__gameSocket;
    if (!socket) return;
    const handler = (d) => setProgress(`${d.voted} / ${d.total} 已投票`);
    socket.on('voteProgress', handler);
    return () => socket.off('voteProgress', handler);
  }, []);

  function handleConfirm() {
    if (!selected) return;
    emit('vote', { targetId: selected });
    setSent(true);
  }

  function handleAbstain() {
    emit('vote', { targetId: null });
    setSent(true);
  }

  if (isSpectator || !me?.alive) {
    return (
      <section className="panel">
        <div className="panel-head"><h2>投票淘汰</h2></div>
        <p className="progress-hint">等待投票... {progress}</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>投票淘汰</h2>
        <p className="panel-hint">选择你认为是卧底的人</p>
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
              <button className="btn btn-accent" onClick={handleConfirm}>确认投票</button>
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>取消</button>
            </div>
          )}
          <button className="btn btn-ghost full-width mt" onClick={handleAbstain}>弃权</button>
        </>
      ) : (
        <p className="progress-hint">✓ 已投票，等待他人... {progress}</p>
      )}
    </section>
  );
}
