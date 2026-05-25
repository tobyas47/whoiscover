import React, { useRef, useEffect, useState } from 'react';
import { useGame } from '../../context/GameContext';

const COLORS = [
  '#1e1e1e','#ffffff','#9b9b9b','#c0392b','#e74c3c','#f39c12',
  '#f1c40f','#27ae60','#2ecc71','#2980b9','#3498db','#8e44ad',
  '#e91e63','#795548','#00bcd4','#ff9800'
];

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
  const [undoStack, setUndoStack] = useState([]);
  const [msg, setMsg] = useState('');
  const lastPos = useRef(null);
  const chatRef = useRef(null);

  // Clear canvas on new turn
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    setUndoStack([]);
  }, [dg.currentRound, dg.currentTurnIndex]);

  // Receive strokes from other players
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
    socket.on('dgStroke', strokeHandler);
    socket.on('dgClear', clearHandler);
    socket.on('dgNewTurn', clearHandler);
    return () => {
      socket.off('dgStroke', strokeHandler);
      socket.off('dgClear', clearHandler);
      socket.off('dgNewTurn', clearHandler);
    };
  }, []);

  // Scroll chat
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

  // Flood fill (local)
  function getPixel(data, x, y, w) {
    const i = (y * w + x) * 4;
    return [data[i], data[i+1], data[i+2]];
  }
  function hexToRgb(hex) {
    const r = parseInt(hex.slice(1,3),16);
    const g = parseInt(hex.slice(3,5),16);
    const b = parseInt(hex.slice(5,7),16);
    return [r,g,b];
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
      if (Math.abs(p[0]-target[0]) > 32 || Math.abs(p[1]-target[1]) > 32 || Math.abs(p[2]-target[2]) > 32) continue;
      visited.add(key);
      const idx = key * 4;
      data[idx] = fill[0]; data[idx+1] = fill[1]; data[idx+2] = fill[2]; data[idx+3] = 255;
      stack.push([cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]);
    }
    ctx.putImageData(imageData, 0, 0);
  }

  function floodFill(x, y) {
    saveUndo();
    floodFillData(x, y, color);
    emit('dgStroke', { type: 'fill', x, y, color });
  }

  function saveUndo() {
    const c = canvasRef.current;
    if (!c) return;
    setUndoStack(prev => [...prev.slice(-19), c.toDataURL()]);
  }

  function undo() {
    const c = canvasRef.current;
    if (!c || undoStack.length === 0) return;
    const img = new Image();
    img.onload = () => {
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0);
    };
    img.onerror = () => {};
    img.src = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    // Resend full canvas state to other players
    emit('dgClear');
    // Note: undo only works locally for the drawer
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
    saveUndo();
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
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    // Emit stroke to others
    emit('dgStroke', { from: lastPos.current, to: pos, color: strokeColor, size });
    lastPos.current = pos;
  }

  function handleUp() {
    setDrawing(false);
    lastPos.current = null;
  }

  function handleClear() {
    const c = canvasRef.current;
    if (!c) return;
    saveUndo();
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    emit('dgClear');
  }

  function sendGuess() {
    if (!msg.trim()) return;
    emit('sendMessage', msg.trim());
    setMsg('');
  }

  // Word display
  const wordDisplay = isDrawer
    ? dg.currentWord
    : (dg.wordHint || '＿'.repeat(dg.wordLength || 0));

  return (
    <section className="panel">
      <div className="dg-header">
        <div className="dg-word-display">
          <span className="dg-word">{wordDisplay}</span>
          {!isDrawer && dg.hint && <span className="dg-hint">{dg.hint}</span>}
        </div>
        <div className="dg-drawer-name">{isDrawer ? '你是画手！' : `画手: ${dg.drawerName || ''}`}</div>
      </div>

      <div className="dg-body">
        <div className="dg-canvas-area">
          {isDrawer && phase === 'dgDrawing' && (
            <>
              <div className="canvas-toolbar">
                <div className="toolbar-group">
                  <button className={`tool-btn ${tool==='pen'?'active':''}`} onClick={()=>setTool('pen')} title="画笔">✏️</button>
                  <button className={`tool-btn ${tool==='fill'?'active':''}`} onClick={()=>setTool('fill')} title="填色">🪣</button>
                  <button className={`tool-btn ${tool==='eraser'?'active':''}`} onClick={()=>setTool('eraser')} title="橡皮擦">🧽</button>
                  <button className="tool-btn" onClick={undo} title="撤销">↩️</button>
                  <button className="tool-btn" onClick={handleClear} title="清空">🗑️</button>
                </div>
                <div className="toolbar-group">
                  <label className="size-label">粗细</label>
                  <input type="range" min="1" max="40" value={size} onChange={e=>setSize(+e.target.value)} className="size-slider" />
                </div>
              </div>
              <div className="color-palette">
                {COLORS.map(c => (
                  <button key={c} className={`color-swatch ${color===c?'active':''}`} style={{background:c}} onClick={()=>setColor(c)} />
                ))}
                <input type="color" value={color} onChange={e=>setColor(e.target.value)} className="color-custom" />
              </div>
            </>
          )}
          <div className="canvas-wrap">
            <canvas
              ref={canvasRef} width={800} height={600}
              onMouseDown={handleDown} onMouseMove={handleMove} onMouseUp={handleUp} onMouseLeave={handleUp}
              onTouchStart={handleDown} onTouchMove={handleMove} onTouchEnd={handleUp}
              style={{ cursor: isDrawer && phase === 'dgDrawing' ? 'crosshair' : 'default' }}
            />
          </div>
        </div>

        <div className="dg-chat-area">
          {/* Scoreboard */}
          <div className="dg-scoreboard">
            {gameState?.players?.map(p => (
              <div key={p.id} className={`dg-score-row ${p.id === dg.drawerId ? 'is-drawer' : ''}`}>
                <span>{p.name}</span>
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
