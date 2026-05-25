import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const GameContext = createContext(null);

export function useGame() {
  return useContext(GameContext);
}

export function GameProvider({ children }) {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [screen, setScreen] = useState('lobby'); // 'lobby' | 'room'
  const [roomId, setRoomId] = useState('');
  const [myId, setMyId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isSpectator, setIsSpectator] = useState(false);
  const [gameState, setGameState] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [toast, setToast] = useState(null);

  // Init socket
  useEffect(() => {
    const socket = io({
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      setMyId(socket.id);
      window.__gameSocket = socket;
      // Try rejoin
      const session = loadSession();
      if (session && session.token) {
        socket.emit('rejoinRoom', session.token, (res) => {
          if (res.success) {
            setMyId(socket.id);
            if (res.spectator) setIsSpectator(true);
            setRoomId(res.roomId);
            setScreen('room');
          } else {
            clearSession();
          }
        });
      }
    });

    socket.on('disconnect', () => setConnected(false));

    socket.on('roomState', (state) => {
      if (state.isSpectator) setIsSpectator(true);
      setIsHost(state.hostId === socket.id);
      setGameState(prev => {
        // Clear chat messages on phase change
        if (prev && prev.phase !== state.phase) setChatMessages([]);
        return state;
      });
    });

    socket.on('chatMessage', (d) => {
      setChatMessages(prev => [...prev, d]);
    });

    socket.on('error', (msg) => alert(msg));

    socket.on('uploadWordsOk', (count) => {
      showToast(`✓ 已加载 ${count} 组词对`);
    });

    socket.on('uploadDgWordsOk', (count) => {
      showToast(`✓ 已加载 ${count} 个词`);
    });

    return () => { socket.disconnect(); };
  }, []);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // Session helpers
  function saveSession(token, rid) {
    sessionStorage.setItem('gameSession', JSON.stringify({ token, roomId: rid }));
  }
  function loadSession() {
    try { return JSON.parse(sessionStorage.getItem('gameSession')); }
    catch { return null; }
  }
  function clearSession() {
    sessionStorage.removeItem('gameSession');
  }

  // Actions
  const createRoom = useCallback((name) => {
    socketRef.current.emit('createRoom', name, (res) => {
      if (res.success) {
        setMyId(socketRef.current.id);
        saveSession(res.token, res.roomId);
        setRoomId(res.roomId);
        setScreen('room');
        history.replaceState(null, '', '#' + res.roomId);
      }
    });
  }, []);

  const joinRoom = useCallback((name, rid) => {
    socketRef.current.emit('joinRoom', { name, roomId: rid }, (res) => {
      if (res.success) {
        setMyId(socketRef.current.id);
        if (res.spectator) setIsSpectator(true);
        if (res.token) saveSession(res.token, res.roomId);
        setRoomId(res.roomId);
        setScreen('room');
        history.replaceState(null, '', '#' + res.roomId);
      } else {
        alert(res.error);
      }
    });
  }, []);

  const emit = useCallback((...args) => {
    socketRef.current?.emit(...args);
  }, []);

  const socket = socketRef.current;

  const value = {
    socket: socketRef,
    connected,
    screen, setScreen,
    roomId, setRoomId,
    myId,
    isHost,
    isSpectator,
    gameState,
    chatMessages, setChatMessages,
    toast, showToast,
    createRoom,
    joinRoom,
    emit
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}
