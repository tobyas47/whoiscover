import React from 'react';
import { useGame } from '../../context/GameContext';
import Settings from '../Settings';

export default function WaitingPanel() {
  const { isHost, gameState, emit } = useGame();
  const mode = gameState?.mode || 'undercover';

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>等待就绪</h2>
      </div>
      {isHost ? (
        <Settings />
      ) : (
        <p className="progress-hint">
          {mode === 'drawguess' ? '等待房主开始 · 你画我猜' : '等待房主开始...'}
        </p>
      )}
    </section>
  );
}
