import React, { useState, useEffect } from 'react';
import { useGame } from '../../context/GameContext';

export default function DgPickPanel() {
  const { gameState, emit } = useGame();
  const dg = gameState?.dg || {};
  const isDrawer = dg.isDrawer;
  const timerEnd = gameState?.timerEnd;

  const [timeLeft, setTimeLeft] = useState(15);

  useEffect(() => {
    if (!timerEnd) return;
    const update = () => setTimeLeft(Math.max(0, Math.round((timerEnd - Date.now()) / 1000)));
    update();
    const id = setInterval(update, 250);
    return () => clearInterval(id);
  }, [timerEnd]);

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🎨 {isDrawer ? '选择要画的词' : `等待 ${dg.drawerName || '画手'} 选词`}</h2>
      </div>
      <div className="dg-pick-timer">
        <div className={`dg-pick-countdown ${timeLeft <= 5 ? 'urgent' : ''}`}>{timeLeft}</div>
        <div className="dg-pick-bar">
          <div className="dg-pick-bar-fill" style={{ width: `${(timeLeft / 15) * 100}%`, background: timeLeft <= 5 ? 'var(--cinnabar)' : 'var(--jade)' }} />
        </div>
      </div>
      {isDrawer ? (
        <div className="dg-choices">
          {(dg.wordChoices || []).map((w, i) => (
            <button key={i} className="btn btn-ghost dg-choice-btn" onClick={() => emit('dgPickWord', w)}>{w}</button>
          ))}
        </div>
      ) : (
        <p className="progress-hint">画手正在选词，请稍候...</p>
      )}
    </section>
  );
}
