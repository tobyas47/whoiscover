import React from 'react';
import { useGame } from '../../context/GameContext';

export default function DgPickPanel() {
  const { gameState, myId, emit } = useGame();
  const dg = gameState?.dg || {};
  const isDrawer = dg.isDrawer;

  function pickWord(word) {
    emit('dgPickWord', word);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🎨 选择一个词来画</h2>
      </div>
      {isDrawer ? (
        <div className="dg-choices">
          {(dg.wordChoices || []).map((w, i) => (
            <button key={i} className="btn btn-ghost" onClick={() => pickWord(w)}>{w}</button>
          ))}
        </div>
      ) : (
        <p className="progress-hint">等待画手选词...</p>
      )}
    </section>
  );
}
