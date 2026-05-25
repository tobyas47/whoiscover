import React from 'react';
import { useGame } from './context/GameContext';
import Lobby from './components/Lobby';
import Room from './components/Room';
import Toast from './components/Toast';

export default function App() {
  const { screen, toast } = useGame();

  return (
    <>
      {screen === 'lobby' && <Lobby />}
      {screen === 'room' && <Room />}
      {toast && <Toast message={toast} />}
    </>
  );
}
