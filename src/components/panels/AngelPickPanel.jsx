import React, { useState } from 'react';
import { useGame } from '../../context/GameContext';

export default function AngelPickPanel() {
  const { gameState, myId, emit } = useGame();
  const [wordA, setWordA] = useState('');
  const [wordB, setWordB] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const me = gameState?.players?.find(p => p.id === myId);
  const isAngel = me?.role === 'angel';

  function handleSubmit() {
    if (!wordA.trim() || !wordB.trim()) return alert('请输入两个词');
    emit('submitAngelWords', { wordA: wordA.trim(), wordB: wordB.trim() });
    setSubmitted(true);
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>天使出词</h2></div>
      {isAngel && !submitted ? (
        <div className="angel-pick-form">
          <p className="panel-hint">请出两个相似的词，系统会随机打乱分配</p>
          <input type="text" placeholder="第一个词" maxLength={20} value={wordA} onChange={e => setWordA(e.target.value)} autoComplete="off" />
          <input type="text" placeholder="第二个词" maxLength={20} value={wordB} onChange={e => setWordB(e.target.value)} autoComplete="off" />
          <button className="btn btn-accent full-width mt" onClick={handleSubmit}>确认出词</button>
        </div>
      ) : (
        <p className="progress-hint">{submitted ? '已提交，等待分配...' : '等待天使出词...'}</p>
      )}
    </section>
  );
}
