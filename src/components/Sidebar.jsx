import React from 'react';
import { useGame } from '../context/GameContext';

function RankHearts({ lives, max }) {
  const total = Math.max(lives, max || lives);
  return (
    <span className="rg-hearts">
      {Array.from({ length: total }).map((_, i) => (
        <span key={i} className={i < lives ? 'rg-heart' : 'rg-heart empty'}>
          {i < lives ? '❤' : '🤍'}
        </span>
      ))}
    </span>
  );
}

export default function Sidebar() {
  const { gameState, myId } = useGame();
  if (!gameState) return null;

  const me = gameState.players?.find(p => p.id === myId);
  const phase = gameState.phase;

  // 番剧人气对决：进行/揭晓阶段把计分板放到侧边栏，主区只留对决画面
  const rg = gameState.rankguess;
  const showRankBoard = (phase === 'rankGuessing' || phase === 'rankReveal') && rg;

  const roleLabels = { good: '好人', undercover: '卧底', angel: '天使', blank: '白板' };
  const goalLabels = {
    good: '找出卧底，投票淘汰',
    undercover: '隐藏身份，存活到最后',
    angel: '保护好人，找出卧底',
    blank: '凭直觉存活'
  };

  return (
    <aside className="room-sidebar">
      {/* Identity Card */}
      {me && (me.role === 'angel' || me.role === 'blank') && phase !== 'waiting' && (
        <section className="identity-card">
          <div className="identity-inner">
            <div className="identity-role">{roleLabels[me.role] || me.role}</div>
            <div className="identity-word">{me.word || (me.role === 'blank' ? '（无词）' : '')}</div>
            {me.word2 && <div className="identity-word">{me.word2}</div>}
            <div className="identity-goal">{goalLabels[me.role] || ''}</div>
          </div>
        </section>
      )}

      {/* 番剧人气对决计分板（替代通用玩家列表，含分数/生命/本轮得失） */}
      {showRankBoard ? (
        <section className="rg-scoreboard rg-scoreboard-side">
          <div className="rg-sb-title">计分板</div>
          <div className="rg-sb-list">
            {[...(rg.players || [])]
              .sort((a, b) => b.score - a.score || b.lives - a.lives)
              .map((p, i) => {
                const r = rg.result?.results?.find(x => x.id === p.id);
                return (
                  <div key={p.id} className={`rg-sb-row${p.id === myId ? ' me' : ''}${p.lives <= 0 ? ' dead' : ''}`}>
                    <span className="rg-sb-rank">{i + 1}</span>
                    <span className="rg-sb-name">{p.name}{p.id === myId ? '（你）' : ''}</span>
                    <RankHearts lives={p.lives} max={rg.startLives} />
                    <span className="rg-sb-score">{p.score} 分</span>
                    {phase === 'rankReveal' && r && (
                      <span className={`rg-sb-delta ${r.correct ? 'good' : 'bad'}`}>
                        {r.correct ? `+${r.points}` : '−1❤'}
                      </span>
                    )}
                  </div>
                );
              })}
          </div>
        </section>
      ) : (
        /* Player List */
        <section className="players-grid">
          {gameState.players?.map(p => (
            <div key={p.id} className={`player-chip ${p.id === myId ? 'is-me' : ''} ${!p.alive ? 'is-dead' : ''} ${p.id === gameState.hostId ? 'is-host' : ''}`}>
              <div className="chip-name">{p.name}</div>
              <div className="chip-status">
                {phase === 'ended' && p.role ? roleLabels[p.role] : (p.alive ? '存活' : '已阵亡')}
              </div>
            </div>
          ))}
        </section>
      )}

      {/* Log (desktop) */}
      {gameState.gameLog && gameState.gameLog.length > 0 && (
        <section className="log-section log-desktop">
          <details>
            <summary className="log-toggle">事件记录</summary>
            <div className="log-body">
              {gameState.gameLog.map((entry, i) => <div key={i} className={`log-entry log-${entry.type}`}>{entry.message}</div>)}
            </div>
          </details>
        </section>
      )}
    </aside>
  );
}
