import React, { useState } from 'react';
import { useGame } from '../../context/GameContext';

export default function BlankGuessPanel() {
  const { gameState, myId, emit } = useGame();
  const [wordA, setWordA] = useState('');
  const [wordB, setWordB] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const isBlank = gameState?.blankGuessPlayer === myId;

  function handleSubmit() {
    if (!wordA.trim() || !wordB.trim()) return alert('请输入两个词');
    emit('submitBlankGuess', { wordA: wordA.trim(), wordB: wordB.trim() });
    setSubmitted(true);
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>白板猜词</h2>
        <p className="panel-hint">猜对两个词即可翻盘胜利！（60秒）</p>
      </div>
      {isBlank && !submitted ? (
        <div className="angel-pick-form">
          <input type="text" placeholder="第一个词" maxLength={20} value={wordA} onChange={e => setWordA(e.target.value)} autoComplete="off" />
          <input type="text" placeholder="第二个词" maxLength={20} value={wordB} onChange={e => setWordB(e.target.value)} autoComplete="off" />
          <button className="btn btn-accent full-width mt" onClick={handleSubmit}>确认猜词</button>
        </div>
      ) : (
        <p className="progress-hint">{submitted ? '已提交，等待结果...' : '等待白板猜词...'}</p>
      )}
    </section>
  );
}
