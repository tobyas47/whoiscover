import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { GameProvider } from './context/GameContext';
import './styles/base.css';
import './styles/lobby.css';
import './styles/room.css';
import './styles/canvas.css';
import './styles/responsive.css';

ReactDOM.createRoot(document.getElementById('app')).render(
  <GameProvider>
    <App />
  </GameProvider>
);
