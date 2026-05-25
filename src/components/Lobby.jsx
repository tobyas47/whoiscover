import React, { useState, useRef, useEffect } from 'react';
import { useGame } from '../context/GameContext';

export default function Lobby() {
  const { createRoom, joinRoom } = useGame();
  const [name, setName] = useState('');
  const [showJoin, setShowJoin] = useState(false);
  const [rid, setRid] = useState('');
  const [rulesOpen, setRulesOpen] = useState(false);
  const nameRef = useRef(null);
  const ridRef = useRef(null);

  // Auto-fill from hash
  useEffect(() => {
    const hash = location.hash.slice(1).trim().toUpperCase();
    if (hash) { setRid(hash); setShowJoin(true); }
  }, []);

  function handleCreate() {
    if (!name.trim()) { shake(nameRef); return; }
    createRoom(name.trim());
  }

  function handleJoin() {
    if (!name.trim()) { shake(nameRef); return; }
    if (!rid.trim()) { shake(ridRef); return; }
    joinRoom(name.trim(), rid.trim());
  }

  function shake(ref) {
    const el = ref.current;
    el.style.animation = 'none';
    el.offsetHeight;
    el.style.animation = 'shake 0.4s ease';
  }

  return (
    <div className="screen active">
      <div className="lobby-container">
        <header className="lobby-header">
          <div className="brand-mark">
            <div className="seal">卧</div>
          </div>
          <h1 className="brand-title">谁是卧底</h1>
          <p className="brand-sub">言辞之间 · 真假难辨</p>
        </header>

        <main className="lobby-main">
          <div className="input-field">
            <label htmlFor="playerName">昵称</label>
            <input
              ref={nameRef}
              type="text" id="playerName"
              placeholder="你叫什么？" maxLength={10}
              value={name} onChange={e => setName(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className="lobby-actions">
            <button className="btn btn-accent" onClick={handleCreate}>创建房间</button>
            <button className="btn btn-ghost" onClick={() => setShowJoin(!showJoin)}>加入房间</button>
          </div>

          {showJoin && (
            <div className="join-panel">
              <div className="input-field">
                <label htmlFor="roomIdInput">房间号</label>
                <input
                  ref={ridRef}
                  type="text" id="roomIdInput"
                  placeholder="六位房间码" maxLength={6}
                  value={rid} onChange={e => setRid(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleJoin()}
                  autoComplete="off"
                />
              </div>
              <button className="btn btn-accent full-width" onClick={handleJoin}>进入房间</button>
            </div>
          )}
        </main>

        <footer className="lobby-rules">
          <div className={`rules-header ${rulesOpen ? 'open' : ''}`} onClick={() => setRulesOpen(!rulesOpen)}>
            <span>游戏规则</span>
            <svg className="chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
          </div>
          {rulesOpen && (
            <div className="rules-body">
              <div className="rule-row"><span className="rule-badge good">好人</span><span>拿到好人词，不知道自己是好人还是卧底</span></div>
              <div className="rule-row"><span className="rule-badge bad">卧底</span><span>拿到坏人词，不知道自己身份</span></div>
              <div className="rule-row"><span className="rule-badge angel">天使</span><span>看到两个词，不知道哪个是好人词</span></div>
              <div className="rule-row"><span className="rule-badge blank">白板</span><span>没有词，凭直觉存活</span></div>
              <div className="rule-divider"></div>
              <div className="rule-row"><span className="rule-badge night">夜</span><span>所有人可刀人。好人刀人→自杀；卧底刀人→目标死</span></div>
              <div className="rule-row"><span className="rule-badge day">昼</span><span>讨论后投票淘汰一人</span></div>
              <div className="rule-row highlight"><span>⚔️</span><span>好人胜：淘汰所有卧底和白板 · 卧底胜：人数≥其他玩家 · 白板胜：好人和卧底全灭</span></div>
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
