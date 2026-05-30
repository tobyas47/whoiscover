import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useGame } from '../../context/GameContext';

function getAnswerOrder(answer) {
  if (answer?.includes('不是')) return 1;
  if (answer?.includes('是')) return 0;
  return 2;
}

function answerLabel(answer) {
  if (answer?.includes('不是')) return '否';
  if (answer?.includes('是')) return '是';
  return '?';
}

function answerColor(answer) {
  if (answer?.includes('不是')) return 'var(--cinnabar)';
  if (answer?.includes('是')) return 'var(--jade)';
  return 'var(--ink-muted)';
}

const HINT_BLOCK_SIZES = [0, 32, 12, 4];

export default function TurtleSoupPanel() {
  const { gameState, chatMessages, emit, isHost } = useGame();
  const [msg, setMsg] = useState('');
  const [sortKey, setSortKey] = useState('default');
  const [sortDir, setSortDir] = useState('asc');
  const [mosaicUrl, setMosaicUrl] = useState(null);
  const chatRef = useRef(null);

  const phase = gameState?.phase;
  const ts = gameState?.turtlesoup;
  const players = gameState?.players || [];
  const isReveal = phase === 'turtleSoupReveal';
  const hintImageUrl = ts?.hintImageUrl || null;
  const hintLevel = ts?.hintLevel || 0;

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  useEffect(() => {
    if (!hintImageUrl || hintLevel === 0) { setMosaicUrl(null); return; }
    const blockSize = HINT_BLOCK_SIZES[Math.min(hintLevel, 3)];
    const proxyUrl = `/api/hint-image?url=${encodeURIComponent(hintImageUrl)}`;
    const img = new Image();
    img.onload = () => {
      const W = img.naturalWidth, H = img.naturalHeight;
      const sw = Math.max(1, Math.round(W / blockSize));
      const sh = Math.max(1, Math.round(H / blockSize));
      const tmp = document.createElement('canvas');
      tmp.width = sw; tmp.height = sh;
      tmp.getContext('2d').drawImage(img, 0, 0, sw, sh);
      const out = document.createElement('canvas');
      out.width = W; out.height = H;
      const ctx = out.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tmp, 0, 0, W, H);
      setMosaicUrl(out.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => setMosaicUrl(null);
    img.src = proxyUrl;
  }, [hintImageUrl, hintLevel]);

  function send() {
    if (!msg.trim() || isReveal) return;
    emit('sendMessage', msg.trim());
    setMsg('');
  }

  function getPlayerName(id) {
    return players.find(p => p.id === id)?.name || id;
  }

  const scores = ts?.scores || [];
  const sortedScores = [...scores].sort((a, b) => b.score - a.score);

  const qaLog = ts?.qaLog || [];

  const sortedQa = useMemo(() => {
    if (sortKey === 'default') return qaLog;
    return [...qaLog].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'player') cmp = a.playerName.localeCompare(b.playerName, 'zh');
      else if (sortKey === 'answer') cmp = getAnswerOrder(a.answer) - getAnswerOrder(b.answer);
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [qaLog, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }

  function sortIcon(key) {
    if (sortKey !== key) return <span style={{ opacity: 0.35, fontSize: '0.7em' }}> ↕</span>;
    return <span style={{ fontSize: '0.7em' }}> {sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  return (
    <section className="panel">
      <div className="ts-layout">
        {/* Left: chat area */}
        <div className="ts-main-col">
          <div className="panel-head">
            <h2>{isReveal ? '游戏结束' : '海龟汤 (根据谜面猜番剧)'}</h2>
            {ts && !isReveal && (
              <span style={{ fontSize: '0.85rem', color: 'var(--ink-muted)' }}>
                已猜对：{ts.guessedCount}/{ts.totalPlayers}
                {ts.isProcessing && ' · AI思考中…'}
              </span>
            )}
          </div>

          {ts?.clue && (
            <div style={{ padding: '0.75rem 0', borderBottom: '1px solid var(--ink-faint)', lineHeight: '1.6', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.7rem', color: 'var(--ink-muted)', display: 'block', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>谜面</span>
              <span style={{ fontSize: '0.95rem' }}>{ts.clue}</span>
            </div>
          )}

          {isReveal && ts?.targetWord && (
            <div style={{ padding: '0.5rem 0', borderBottom: '1px solid var(--ink-faint)', fontSize: '1rem', marginBottom: '8px' }}>
              答案是：<strong>{ts.targetWord}</strong>
            </div>
          )}

          {!isReveal && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0', marginBottom: '8px', borderBottom: mosaicUrl ? 'none' : '1px solid var(--ink-faint)' }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: '0.8rem', padding: '0.2rem 0.7rem' }}
                onClick={() => emit('requestHint')}
                disabled={hintLevel >= 3}
              >
                图片提示{hintLevel > 0 ? ` (${hintLevel}/3)` : ''}
              </button>
              {hintLevel > 0 && hintLevel < 3 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>
                  再点一次可以看得更清楚
                </span>
              )}
              {hintLevel >= 3 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>已达最高清晰度</span>
              )}
            </div>
          )}

          {mosaicUrl && (
            <div style={{ marginBottom: '8px', borderBottom: '1px solid var(--ink-faint)', paddingBottom: '8px', textAlign: 'center' }}>
              <img
                src={mosaicUrl}
                alt="图片提示"
                style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', imageRendering: 'pixelated', display: 'block', margin: '0 auto' }}
              />
            </div>
          )}

          {sortedScores.length > 0 && (
            <div style={{ padding: '0.25rem 0', borderBottom: '1px solid var(--ink-faint)', fontSize: '0.85rem', marginBottom: '8px' }}>
              {sortedScores.map((s, i) => (
                <span key={s.id} style={{ marginRight: '1rem' }}>
                  {i + 1}. {getPlayerName(s.id)} {s.score}分
                </span>
              ))}
            </div>
          )}

          <div className="chat-scroll" ref={chatRef}>
            {chatMessages.map((d, i) => {
              let cls = 'chat-bubble';
              if (d.type === 'system') cls += ' system';
              if (d.name === 'AI' || d.sender === 'AI') cls += ' ai-msg';
              return (
                <div key={i} className={cls}>
                  {d.type !== 'system' && <span className="chat-name">{d.name || d.sender || ''}</span>}
                  {' '}
                  {d.message || d.text}
                </div>
              );
            })}
          </div>

          {!isReveal && (
            <div className="chat-bar">
              <input
                type="text" placeholder="向AI提问（是/否）或直接猜番剧名..." maxLength={200}
                value={msg} onChange={e => setMsg(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && send()}
                autoComplete="off"
              />
              <button className="btn btn-send" onClick={send}>↑</button>
            </div>
          )}

          {isHost && !isReveal && (
            <div style={{ paddingTop: '0.5rem' }}>
              <button className="btn btn-ghost full-width" onClick={() => emit('turtlesoupEndGame')}>
                结束游戏（公布答案）
              </button>
            </div>
          )}

          {isHost && isReveal && (
            <div style={{ paddingTop: '0.5rem' }}>
              <button className="btn btn-accent full-width" onClick={() => emit('turtlesoupReturnToLobby')}>
                返回大厅
              </button>
            </div>
          )}
        </div>

        {/* Right: Q&A log table */}
        {qaLog.length > 0 && (
          <div className="ts-qa-sidebar">
            <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: '8px' }}>
              提问记录 ({qaLog.length})
            </div>
            <div className="ts-qa-scroll">
              <table className="ts-qa-table">
                <thead>
                  <tr>
                    <th onClick={() => toggleSort('player')} title="按提问者排序">
                      提问者{sortIcon('player')}
                    </th>
                    <th>问题</th>
                    <th onClick={() => toggleSort('answer')} title="按答案排序">
                      答案{sortIcon('answer')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedQa.map((row, i) => (
                    <tr key={i}>
                      <td className="ts-qa-name">{row.playerName}</td>
                      <td>{row.question}</td>
                      <td style={{ color: answerColor(row.answer), fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {answerLabel(row.answer)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
