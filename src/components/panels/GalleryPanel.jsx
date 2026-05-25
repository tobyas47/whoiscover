import React, { useState } from 'react';
import { useGame } from '../../context/GameContext';

export default function GalleryPanel() {
  const { gameState } = useGame();
  const [modalImg, setModalImg] = useState(null);

  const drawings = gameState?.drawings || [];

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>🖼️ 画廊</h2>
        <p className="panel-hint">点击可放大查看</p>
      </div>
      <div className="gallery-grid">
        {drawings.map((d, i) => (
          <div key={i} className="gallery-item" onClick={() => setModalImg(d)}>
            <img src={d.dataUrl} alt={d.name} />
            <div className="gallery-name">{d.name}</div>
          </div>
        ))}
      </div>

      {modalImg && (
        <div className="gallery-modal" onClick={() => setModalImg(null)}>
          <div className="gallery-modal-backdrop"></div>
          <div className="gallery-modal-content" onClick={e => e.stopPropagation()}>
            <img src={modalImg.dataUrl} alt={modalImg.name} />
            <div className="gallery-modal-name">{modalImg.name}</div>
            <button className="gallery-modal-close" onClick={() => setModalImg(null)}>✕</button>
          </div>
        </div>
      )}
    </section>
  );
}
