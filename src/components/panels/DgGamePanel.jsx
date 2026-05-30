import React, { useRef, useEffect, useState } from 'react';
import { useGame } from '../../context/GameContext';

const COLORS = [
  // 黑白灰
  '#1e1e1e', '#ffffff', '#9e9e9e', '#e0e0e0',
  // 红
  '#c0392b', '#e74c3c', '#ff8a80',
  // 粉
  '#ad1457', '#e91e63', '#f48fb1',
  // 橙
  '#e65100', '#ff9800', '#ffcc02',
  // 黄
  '#f1c40f', '#fff176',
  // 绿
  '#2e7d32', '#27ae60', '#4caf50', '#a5d6a7',
  // 蓝
  '#1565c0', '#2980b9', '#64b5f6',
  // 青
  '#00838f', '#00bcd4',
  // 紫
  '#6a1b9a', '#8e44ad', '#ce93d8',
  // 棕
  '#3e2723', '#795548',
  // 肤色（浅→深）
  '#fddbb4', '#f0c27f', '#e8a96a', '#c8865c', '#a0522d', '#7b3f00',
];

const SIZE_PRESETS = [2, 5, 10, 20, 35];

const TOOL_CURSOR = { pen: 'crosshair', eraser: 'cell', fill: 'copy' };

export default function DgGamePanel() {
  const { gameState, myId, emit, chatMessages } = useGame();
  const canvasRef = useRef(null);
  const dg = gameState?.dg || {};
  const phase = gameState?.phase;
  const isDrawer = dg.drawerId === myId;

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState('#1e1e1e');
  const [size, setSize] = useState(5);
  const [drawing, setDrawing] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [msg, setMsg] = useState('');
  const lastPos = useRef(null);
  const chatRef = useRef(null);
  // stroke-count based undo: tracks how many strokes we've sent, and snapshots at each mousedown
  const strokeCountRef = useRef(0);
  const undoPointsRef = useRef([]);

  // Clear canvas and reset undo state when a new drawer/round starts
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    undoPointsRef.current = [];
    strokeCountRef.current = 0;
    setCanUndo(false);
  }, [dg.drawerId, dg.roundNum]);

  // When entering drawing phase, request current strokes (handles reconnect / spectator join)
  useEffect(() => {
    if (phase === 'dgDrawing') {
      emit('dgRequestStrokes');
    }
  }, [phase]);

  // Socket: receive strokes from others, canvas clear, and full redraw on undo
  useEffect(() => {
    const socket = window.__gameSocket;
    if (!socket) return;

    const strokeHandler = (stroke) => drawStroke(stroke);

    const clearHandler = () => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
    };

    const newTurnHandler = () => {
      clearHandler();
      undoPointsRef.current = [];
      strokeCountRef.current = 0;
      setCanUndo(false);
    };

    const redrawHandler = (strokes) => {
      const c = canvasRef.current;
      if (!c) return;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      for (const s of strokes) drawStroke(s);
      // Sync count for drawer after server confirms the undo
      strokeCountRef.current = strokes.length;
    };

    socket.on('dgStroke', strokeHandler);
    socket.on('dgClear', clearHandler);
    socket.on('dgNewTurn', newTurnHandler);
    socket.on('dgRedrawStrokes', redrawHandler);
    return () => {
      socket.off('dgStroke', strokeHandler);
      socket.off('dgClear', clearHandler);
      socket.off('dgNewTurn', newTurnHandler);
      socket.off('dgRedrawStrokes', redrawHandler);
    };
  }, []);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chatMessages]);

  function drawStroke(stroke) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (stroke.type === 'fill') {
      floodFillData(stroke.x, stroke.y, stroke.color);
      return;
    }
    ctx.beginPath();
    ctx.moveTo(stroke.from.x, stroke.from.y);
    ctx.lineTo(stroke.to.x, stroke.to.y);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function getPixel(data, x, y, w) {
    const i = (y * w + x) * 4;
    return [data[i], data[i + 1], data[i + 2]];
  }
  function hexToRgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }

  function floodFillData(x, y, fillColor) {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    const imageData = ctx.getImageData(0, 0, c.width, c.height);
    const data = imageData.data;
    const target = getPixel(data, x, y, c.width);
    const fill = hexToRgb(fillColor);
    if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2]) return;
    const stack = [[x, y]];
    const visited = new Set();
    while (stack.length > 0) {
      const [cx, cy] = stack.pop();
      const key = cy * c.width + cx;
      if (visited.has(key)) continue;
      if (cx < 0 || cx >= c.width || cy < 0 || cy >= c.height) continue;
      const p = getPixel(data, cx, cy, c.width);
      if (Math.abs(p[0] - target[0]) > 32 || Math.abs(p[1] - target[1]) > 32 || Math.abs(p[2] - target[2]) > 32) continue;
      visited.add(key);
      const idx = key * 4;
      data[idx] = fill[0]; data[idx + 1] = fill[1]; data[idx + 2] = fill[2]; data[idx + 3] = 255;
      stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function floodFill(x, y) {
    pushUndoPoint();
    floodFillData(x, y, color);
    emit('dgStroke', { type: 'fill', x, y, color });
    strokeCountRef.current++;
  }

  function pushUndoPoint() {
    undoPointsRef.current = [...undoPointsRef.current, strokeCountRef.current];
    setCanUndo(true);
  }

  function undo() {
    if (undoPointsRef.current.length === 0) return;
    const points = undoPointsRef.current.slice(0, -1);
    const keepCount = undoPointsRef.current[undoPointsRef.current.length - 1];
    undoPointsRef.current = points;
    strokeCountRef.current = keepCount;
    setCanUndo(points.length > 0);
    emit('dgUndoStrokes', keepCount);
    // Canvas will be redrawn by dgRedrawStrokes response from server
  }

  function getPos(e) {
    const c = canvasRef.current;
    const rect = c.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: (clientX - rect.left) * (c.width / rect.width),
      y: (clientY - rect.top) * (c.height / rect.height)
    };
  }

  function handleDown(e) {
    if (!isDrawer || phase !== 'dgDrawing') return;
    e.preventDefault();
    const pos = getPos(e);
    if (tool === 'fill') {
      floodFill(Math.floor(pos.x), Math.floor(pos.y));
      return;
    }
    pushUndoPoint();
    setDrawing(true);
    lastPos.current = pos;
  }

  function handleMove(e) {
    if (!drawing || !isDrawer) return;
    e.preventDefault();
    const c = canvasRef.current;
    const ctx = c.getContext('2d');
    const pos = getPos(e);
    const strokeColor = tool === 'eraser' ? '#ffffff' : color;
    const strokeSize = tool === 'eraser' ? size * 2 : size;
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    emit('dgStroke', { from: lastPos.current, to: pos, color: strokeColor, size: strokeSize });
    strokeCountRef.current++;
    lastPos.current = pos;
  }

  function handleUp() {
    setDrawing(false);
    lastPos.current = null;
  }

  function handleClear() {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    emit('dgClear');
    // After a full clear, server resets strokes to [], so undo history is also gone
    undoPointsRef.current = [];
    strokeCountRef.current = 0;
    setCanUndo(false);
  }

  function sendGuess() {
    if (!msg.trim()) return;
    emit('sendMessage', msg.trim());
    setMsg('');
  }

  const wordDisplay = isDrawer
    ? dg.currentWord
    : (dg.wordHint || '＿'.repeat(dg.wordLength || 0));

  const activeCursor = isDrawer && phase === 'dgDrawing'
    ? (TOOL_CURSOR[tool] || 'crosshair')
    : 'default';

  return (
    <section className="panel">
      <div className="dg-header">
        <div className="dg-word-display">
          <span className="dg-word">{wordDisplay}</span>
          {!isDrawer && dg.hint && <span className="dg-hint">{dg.hint}</span>}
        </div>
        <div className="dg-meta">
          <span className="dg-round-badge">第 {dg.roundNum || 1} / {dg.maxRounds || 2} 轮</span>
          <span className="dg-drawer-name">{isDrawer ? '✏️ 你来画' : `画手: ${dg.drawerName || ''}`}</span>
        </div>
      </div>

      <div className="dg-body">
        <div className="dg-canvas-area">
          {isDrawer && phase === 'dgDrawing' && (
            <>
              <div className="canvas-toolbar">
                <div className="toolbar-group">
                  <button className={`tool-btn ${tool === 'pen' ? 'active' : ''}`} onClick={() => setTool('pen')} title="画笔">✏️</button>
                  <button className={`tool-btn ${tool === 'fill' ? 'active' : ''}`} onClick={() => setTool('fill')} title="填色">🪣</button>
                  <button className={`tool-btn ${tool === 'eraser' ? 'active' : ''}`} onClick={() => setTool('eraser')} title="橡皮擦">🧽</button>
                  <div className="toolbar-sep" />
                  <button className="tool-btn" onClick={undo} disabled={!canUndo} title="撤销">↩️</button>
                  <button className="tool-btn" onClick={handleClear} title="清空画布">🗑️</button>
                </div>
                <div className="toolbar-group size-group">
                  <label className="size-label">{tool === 'eraser' ? '擦除' : '粗细'}</label>
                  <div className="size-presets">
                    {SIZE_PRESETS.map(s => (
                      <button key={s} className={`size-preset-btn ${size === s ? 'active' : ''}`} onClick={() => setSize(s)} title={`粗细 ${s}`}>
                        <span className="size-dot" style={{ width: Math.min(s * 0.75 + 2, 20), height: Math.min(s * 0.75 + 2, 20) }} />
                      </button>
                    ))}
                  </div>
                  <input type="range" min="1" max="40" value={size} onChange={e => setSize(+e.target.value)} className="size-slider" />
                  <span className="size-val">{tool === 'eraser' ? size * 2 : size}</span>
                </div>
              </div>
              <div className="color-palette">
                {COLORS.map(c => (
                  <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => { setColor(c); setTool('pen'); }} />
                ))}
                <input type="color" value={color} onChange={e => { setColor(e.target.value); setTool('pen'); }} className="color-custom" title="自定义颜色" />
                <div className="color-current" style={{ background: tool === 'eraser' ? '#fff' : color }} title="当前颜色" />
              </div>
            </>
          )}
          <div className="canvas-wrap">
            <canvas
              ref={canvasRef} width={800} height={600}
              onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}
              onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
              style={{ cursor: activeCursor }}
            />
          </div>
        </div>

        <div className="dg-chat-area">
          <div className="dg-scoreboard">
            {gameState?.players?.map(p => (
              <div key={p.id} className={`dg-score-row ${p.id === dg.drawerId ? 'is-drawer' : ''} ${dg.guessedPlayers?.includes(p.id) ? 'has-guessed' : ''}`}>
                <span className="dg-score-name">{p.id === dg.drawerId ? '✏️ ' : dg.guessedPlayers?.includes(p.id) ? '✓ ' : ''}{p.name}</span>
                <span>{p.score || 0}分</span>
              </div>
            ))}
          </div>
          <div className="chat-scroll" ref={chatRef}>
            {chatMessages.map((d, i) => (
              <div key={d.id || `${i}-${d.name}`} className="chat-bubble">
                <span className="chat-name">{d.name}</span> {d.message}
              </div>
            ))}
          </div>
          {!isDrawer && phase === 'dgDrawing' && (() => {
            const guessed = dg.guessedPlayers?.includes(myId);
            return (
              <div className="chat-bar">
                <input
                  type="text"
                  placeholder={guessed ? '✓ 你已猜对！' : '输入你的猜测...'}
                  maxLength={50}
                  value={msg} onChange={e => setMsg(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendGuess()}
                  autoComplete="off"
                  disabled={guessed}
                />
                <button className="btn btn-send" onClick={sendGuess} disabled={guessed}>↑</button>
              </div>
            );
          })()}
        </div>
      </div>

      {phase === 'dgReveal' && (
        <div className="dg-reveal">
          <p>答案是：<strong>{dg.currentWord}</strong></p>
        </div>
      )}
    </section>
  );
}
