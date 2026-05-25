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
          </main>
        </div>
      </div>
    </div>
  );
}
