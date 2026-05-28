import React, { useEffect } from 'react';
import { useGame } from '../context/GameContext';
import RoomHeader from './RoomHeader';
import Sidebar from './Sidebar';
import WaitingPanel from './panels/WaitingPanel';
import NightPanel from './panels/NightPanel';
import DayPanel from './panels/DayPanel';
import VotePanel from './panels/VotePanel';
import AngelPickPanel from './panels/AngelPickPanel';
import BlankGuessPanel from './panels/BlankGuessPanel';
import EndPanel from './panels/EndPanel';
import DgPickPanel from './panels/DgPickPanel';
import DgGamePanel from './panels/DgGamePanel';
import DgEndPanel from './panels/DgEndPanel';
import AIGuessPanel from './panels/AIGuessPanel';
import TurtleSoupPanel from './panels/TurtleSoupPanel';

export default function Room() {
  const { gameState } = useGame();
  const phase = gameState?.phase || 'waiting';

  useEffect(() => {
    document.body.classList.toggle('night', phase === 'night');
    return () => document.body.classList.remove('night');
  }, [phase]);

  return (
    <div className="screen active">
      <div className="room-container">
        <RoomHeader />
        <div className="room-body">
          <Sidebar />
          <main className="room-main">
            {phase === 'waiting' && <WaitingPanel />}
            {phase === 'angelPick' && <AngelPickPanel />}
            {phase === 'night' && <NightPanel />}
            {phase === 'day' && <DayPanel />}
            {phase === 'vote' && <VotePanel />}
            {phase === 'blankGuess' && <BlankGuessPanel />}
            {phase === 'ended' && <EndPanel />}
            {phase === 'dgPicking' && <DgPickPanel />}
            {phase === 'dgDrawing' && <DgGamePanel />}
            {phase === 'dgReveal' && <DgGamePanel />}
            {phase === 'dgEnded' && <DgEndPanel />}
            {phase === 'loading' && (
              <section className="panel">
                <div className="panel-head">
                  <h2>{gameState?.mode === 'turtlesoup' ? '正在准备谜题...' : '正在加载词库...'}</h2>
                </div>
                <p style={{ padding: '1rem', color: 'var(--text-muted)' }}>正在从 Bangumi 获取番剧列表，请稍候</p>
              </section>
            )}
            {phase === 'aiGuessing' && <AIGuessPanel />}
            {phase === 'aiguessReveal' && <AIGuessPanel />}
            {phase === 'turtleSoupGuessing' && <TurtleSoupPanel />}
            {phase === 'turtleSoupReveal' && <TurtleSoupPanel />}
          </main>
        </div>
      </div>
    </div>
  );
}
