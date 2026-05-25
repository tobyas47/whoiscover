import React, { useState, useRef, useEffect } from 'react';
import { useGame } from '../../context/GameContext';

export default function DayPanel() {
  const { gameState, myId, isHost, emit, chatMessages, showToast } = useGame();
  const [msg, setMsg] = useState('');
  const [ready, setReady] = useState(false);
  const chatRef = useRef(null);

  // Use server iReady state, reset on round change
  useEffect(() => {
    setReady(gameState?.iReady || false);
  }, [gameState?.round]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  function send() {
    if (!msg.trim()) return;
    emit('sendMessage', msg.trim());
    setMsg('');
  }

  function handleReady() {
    emit('confirmReady');
    setReady(true);
    showToast('已确认讨论完毕，等待其他玩家...');
  }

  return (
    <section className="panel">
      <div className="panel-head"><h2>自由讨论</h2></div>

      <div className="chat-scroll" ref={chatRef}>
        {chatMessages.map((d, i) => (
          <div key={i} className="chat-bubble">
            <span className="chat-name">{d.name}</span> {d.message}
          </div>
        ))}
      </div>

      <div className="chat-bar">
        <input
          type="text" placeholder="说点什么..." maxLength={200}
          value={msg} onChange={e => setMsg(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          autoComplete="off"
        />
        <button className="btn btn-send" onClick={send}>↑</button>
      </div>

      <div className="ready-bar">
        <button
          className={`btn btn-ghost full-width ${ready ? 'btn-confirmed' : ''}`}
          onClick={handleReady} disabled={ready}
        >
          {ready ? '✓ 已确认' : '✓ 讨论完毕'}
        </button>
        <span className="ready-count">{gameState?.readyCount || 0}/{gameState?.readyTotal || 0}</span>
      </div>

      {isHost && (
        <button className="btn btn-accent full-width mt" onClick={() => emit('endDiscussion')}>
          结束讨论 · 投票
        </button>
      )}
    </section>
  );
}
