import React, { useEffect, useState } from 'react';
import { useGame } from '../../context/GameContext';

function Hearts({ lives, max }) {
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

function Card({ card, side, picked, disabled, onPick, reveal, winner, isWinner }) {
  if (!card) return <div className="rg-card rg-card-empty" />;
  const cls = [
    'rg-card',
    picked ? 'picked' : '',
    reveal && isWinner ? 'winner' : '',
    reveal && !isWinner ? 'loser' : '',
    disabled ? 'disabled' : '',
  ].filter(Boolean).join(' ');
  return (
    <button className={cls} onClick={() => !disabled && onPick(side)} disabled={disabled}>
      <div className="rg-card-img-wrap">
        {card.imageUrl
          ? <img className="rg-card-img" src={card.imageUrl} alt={card.name} draggable={false} />
          : <div className="rg-card-noimg">无封面</div>}
        {reveal && isWinner && <div className="rg-winner-badge">人气更高 👑</div>}
        {picked && <div className="rg-picked-badge">你的选择</div>}
      </div>
      <div className="rg-card-body">
        <div className="rg-card-name">{card.name}</div>
        {card.year && <div className="rg-card-year">{card.year}</div>}
        {reveal && (
          <div className="rg-card-stats">
            <span className="rg-card-count">{(card.ratingCount ?? 0).toLocaleString()} 人评分</span>
            {card.score ? <span className="rg-card-score">★ {card.score}</span> : null}
          </div>
        )}
      </div>
    </button>
  );
}

export default function RankGuessPanel() {
  const { gameState, emit, isHost, myId } = useGame();
  const rg = gameState?.rankguess;
  const phase = gameState?.phase;
  const isReveal = phase === 'rankReveal';
  const isEnded = phase === 'rankEnded';
  const isPlaying = phase === 'rankGuessing';

  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const end = gameState?.timerEnd;
    if (!end) { setRemaining(0); return; }
    const tick = () => setRemaining(Math.max(0, Math.ceil((end - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [gameState?.timerEnd]);

  if (!rg) return null;

  const players = rg.players || [];
  const sorted = [...players].sort((a, b) => b.score - a.score || b.lives - a.lives);
  const myChoice = rg.myChoice;
  const myLives = rg.myLives ?? rg.startLives;
  const amDead = myLives <= 0;
  const result = rg.result;
  const winnerSide = result?.winnerSide;

  const myResult = result?.results?.find(r => r.id === myId);

  const canPick = isPlaying && !amDead && !myChoice;

  function pick(side) {
    if (!canPick) return;
    emit('rankguessPick', side);
  }

  function getName(id) {
    return players.find(p => p.id === id)?.name || '玩家';
  }

  return (
    <section className="panel rg-panel">
      <div className="panel-head">
        <h2>
          {isEnded ? '对决结束 🏆' : '番剧人气对决'}
          {!isEnded && <span className="rg-round">第 {rg.roundNum} 轮</span>}
        </h2>
        {!isEnded && (
          <div className="rg-head-right">
            <span className="rg-progress">已选 {rg.pickedCount}/{rg.aliveCount}</span>
            <span className="rg-pool">剩余 {Math.max(0, rg.poolTotal - rg.poolDone)} 张</span>
            {(isPlaying || isReveal) && remaining > 0 && (
              <span className={`rg-timer${isPlaying && remaining <= 5 ? ' urgent' : ''}`}>
                {isReveal ? `${remaining}s 后下一轮` : `${remaining}s`}
              </span>
            )}
          </div>
        )}
      </div>

      {!isEnded && (
        <>
          <div className="rg-prompt">
            {isReveal
              ? (winnerSide === 'tie' ? '两部人气相同！' : '揭晓：评分人数（人气）更高的是 →')
              : (amDead ? '你已出局，观战中…' : (myChoice ? '已锁定选择，等待其他玩家…' : '点击你认为「评分人数（人气）」更高的番剧'))}
          </div>

          <div className="rg-arena">
            <Card
              card={rg.left} side="left"
              picked={myChoice === 'left'}
              disabled={!canPick}
              onPick={pick}
              reveal={isReveal}
              isWinner={isReveal && (winnerSide === 'left' || winnerSide === 'tie')}
            />
            <div className="rg-vs">VS</div>
            <Card
              card={rg.right} side="right"
              picked={myChoice === 'right'}
              disabled={!canPick}
              onPick={pick}
              reveal={isReveal}
              isWinner={isReveal && (winnerSide === 'right' || winnerSide === 'tie')}
            />
          </div>

          <div className="rg-mystatus">
            <span>我的生命：<Hearts lives={myLives} max={rg.startLives} /></span>
            {isReveal && myResult && (
              <span className={myResult.correct ? 'rg-res-good' : 'rg-res-bad'}>
                {myResult.correct ? `✓ 答对 +${myResult.points} 分` : '✗ 答错 −1 生命'}
              </span>
            )}
            {isReveal && !myResult && !amDead && (
              <span className="rg-res-bad">✗ 未选择 −1 生命</span>
            )}
          </div>
        </>
      )}

      {/* 计分板：进行/揭晓阶段移到侧边栏，这里仅在结算页显示最终排名 */}
      {isEnded && (
      <div className="rg-scoreboard">
        <div className="rg-sb-title">最终排名</div>
        <div className="rg-sb-list">
          {sorted.map((p, i) => {
            const r = result?.results?.find(x => x.id === p.id);
            return (
              <div key={p.id} className={`rg-sb-row${p.id === myId ? ' me' : ''}${p.lives <= 0 ? ' dead' : ''}`}>
                <span className="rg-sb-rank">{i + 1}</span>
                <span className="rg-sb-name">{p.name}{p.id === myId ? '（你）' : ''}</span>
                <Hearts lives={p.lives} max={rg.startLives} />
                <span className="rg-sb-score">{p.score} 分</span>
                {isReveal && r && (
                  <span className={`rg-sb-delta ${r.correct ? 'good' : 'bad'}`}>
                    {r.correct ? `+${r.points}` : '−1❤'}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      )}

      {isHost && (isPlaying || isReveal) && (
        <button className="btn btn-ghost full-width mt" onClick={() => emit('rankguessEndGame')}>
          结束游戏
        </button>
      )}
      {isHost && isEnded && (
        <button className="btn btn-accent full-width mt" onClick={() => emit('rankguessReturnToLobby')}>
          返回大厅
        </button>
      )}
    </section>
  );
}
