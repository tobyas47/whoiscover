import React, { useState, useRef, useEffect } from 'react';
import { useGame } from '../context/GameContext';

export default function Settings() {
  const { gameState, emit, showToast } = useGame();
  const s = gameState?.settings || {};
  const [mode, setMode] = useState(gameState?.mode || 'undercover');
  const [ucCount, setUcCount] = useState(s.undercoverCount || 1);
  const [angelCount, setAngelCount] = useState(s.angelCount || 0);
  const [blankCount, setBlankCount] = useState(s.blankCount || 0);
  const [wordSource, setWordSource] = useState(s.wordSource || 'builtin');
  const [dayTimer, setDayTimer] = useState(s.dayTimer || 120);
  const [nightTimer, setNightTimer] = useState(s.nightTimer || 30);
  const [voteTimer, setVoteTimer] = useState(s.voteTimer || 30);
  const [dgRounds, setDgRounds] = useState(gameState?.dg?.maxRounds || 2);
  const [dgTimer, setDgTimer] = useState(gameState?.dg?.drawTimer || 80);

  // Bangumi settings
  const [dgWordSource, setDgWordSource] = useState(gameState?.dg?.wordSource || gameState?.dgWordSource || 'builtin');
  const _initBgm = gameState?.dg?.bangumiOpts || gameState?.dgBangumiOpts || {};
  const [bgmKeyword, setBgmKeyword] = useState(_initBgm.keyword || '');
  const [bgmType, setBgmType] = useState(_initBgm.type?.length ? _initBgm.type : [2]);
  const [bgmYear, setBgmYear] = useState(_initBgm.year || '');
  const [bgmYearEnd, setBgmYearEnd] = useState(_initBgm.yearEnd || '');
  const [bgmMonth, setBgmMonth] = useState(_initBgm.month || '');
  const [bgmTag, setBgmTag] = useState((_initBgm.tag || []).join(','));
  const [bgmSort, setBgmSort] = useState(_initBgm.sort || 'rank');
  const [bgmRankMin, setBgmRankMin] = useState(_initBgm.rankMin || '');
  const [bgmRankMax, setBgmRankMax] = useState(_initBgm.rankMax || '');
  const [bgmRatingMin, setBgmRatingMin] = useState(_initBgm.ratingMin || '');
  const [bgmRatingCountMin, setBgmRatingCountMin] = useState(_initBgm.ratingCountMin || '');

  // Sync local state when server broadcasts updated gameState
  useEffect(() => {
    if (!gameState) return;
    if (gameState.mode) setMode(gameState.mode);
    const ns = gameState.settings || {};
    if (ns.undercoverCount != null) setUcCount(ns.undercoverCount);
    if (ns.angelCount != null) setAngelCount(ns.angelCount);
    if (ns.blankCount != null) setBlankCount(ns.blankCount);
    if (ns.wordSource) setWordSource(ns.wordSource);
    if (ns.dayTimer) setDayTimer(ns.dayTimer);
    if (ns.nightTimer) setNightTimer(ns.nightTimer);
    if (ns.voteTimer) setVoteTimer(ns.voteTimer);
    if (gameState.dg?.maxRounds) setDgRounds(gameState.dg.maxRounds);
    if (gameState.dg?.drawTimer) setDgTimer(gameState.dg.drawTimer);
    const wsrc = gameState.dg?.wordSource || gameState.dgWordSource;
    if (wsrc) setDgWordSource(wsrc);
    const bOpts = gameState.dg?.bangumiOpts ?? gameState.dgBangumiOpts;
    if (bOpts) {
      if (bOpts.keyword != null) setBgmKeyword(bOpts.keyword || '');
      if (bOpts.type?.length) setBgmType(bOpts.type);
      if (bOpts.year != null) setBgmYear(bOpts.year || '');
      if (bOpts.yearEnd != null) setBgmYearEnd(bOpts.yearEnd || '');
      if (bOpts.month != null) setBgmMonth(bOpts.month || '');
      if (bOpts.tag) setBgmTag(bOpts.tag.join(','));
      if (bOpts.sort) setBgmSort(bOpts.sort);
      if (bOpts.rankMin != null) setBgmRankMin(bOpts.rankMin || '');
      if (bOpts.rankMax != null) setBgmRankMax(bOpts.rankMax || '');
      if (bOpts.ratingMin != null) setBgmRatingMin(bOpts.ratingMin || '');
      if (bOpts.ratingCountMin != null) setBgmRatingCountMin(bOpts.ratingCountMin || '');
    }
  }, [gameState]);

  function sync(overrides = {}) {
    const data = {
      mode, undercoverCount: ucCount, angelCount, blankCount,
      wordSource, dayTimer, nightTimer, voteTimer,
      dgMaxRounds: dgRounds, dgDrawTimer: dgTimer,
      dgWordSource: overrides.dgWordSource || dgWordSource,
      dgBangumiOpts: {
        keyword: overrides.bgmKeyword ?? bgmKeyword,
        type: overrides.bgmType ?? bgmType,
        year: (overrides.bgmYear ?? bgmYear) || null,
        yearEnd: (overrides.bgmYearEnd ?? bgmYearEnd) || null,
        month: (overrides.bgmMonth ?? bgmMonth) || null,
        tag: (overrides.bgmTag ?? bgmTag) ? (overrides.bgmTag ?? bgmTag).split(',').map(t => t.trim()).filter(Boolean) : [],
        sort: overrides.bgmSort ?? bgmSort,
        rankMin: (overrides.bgmRankMin ?? bgmRankMin) || null,
        rankMax: (overrides.bgmRankMax ?? bgmRankMax) || null,
        ratingMin: (overrides.bgmRatingMin ?? bgmRatingMin) || null,
        ratingCountMin: (overrides.bgmRatingCountMin ?? bgmRatingCountMin) || null
      },
      ...overrides
    };
    emit('updateSettings', data);
  }

  function handleModeChange(e) {
    const v = e.target.value;
    setMode(v);
    sync({ mode: v });
  }

  function handleUpload(e, type) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        emit(type === 'uc' ? 'uploadWords' : 'uploadDgWords', data);
      } catch {
        alert('JSON格式错误');
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="settings">
      <div className="setting-row mode-switch">
        <span>游戏模式</span>
        <select value={mode} onChange={handleModeChange}>
          <option value="undercover">谁是卧底</option>
          <option value="drawguess">你画我猜</option>
          <option value="aiguess">AI猜番</option>
        </select>
      </div>
      <div className="setting-divider"></div>

      {(mode === 'drawguess' || mode === 'aiguess') ? (
        <div>
          {mode === 'drawguess' && (
            <>
              <div className="setting-row">
                <span>回合数</span>
                <select value={dgRounds} onChange={e => { setDgRounds(+e.target.value); sync({ dgMaxRounds: +e.target.value }); }}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}轮</option>)}
                </select>
              </div>
              <div className="setting-row">
                <span>画画时长</span>
                <select value={dgTimer} onChange={e => { setDgTimer(+e.target.value); sync({ dgDrawTimer: +e.target.value }); }}>
                  {[40,60,80,100,120].map(n => <option key={n} value={n}>{n >= 120 ? `${n/60}分钟` : `${n}秒`}</option>)}
                </select>
              </div>
              <div className="setting-divider"></div>
              <div className="setting-row">
                <span>词库来源</span>
                <select value={dgWordSource} onChange={e => { setDgWordSource(e.target.value); sync({ dgWordSource: e.target.value }); }}>
                  <option value="builtin">内置词库</option>
                  <option value="upload">上传词库</option>
                  <option value="bangumi">Bangumi动画</option>
                </select>
              </div>
            </>
          )}

          {dgWordSource === 'upload' && mode === 'drawguess' && (
            <div>
              <input type="file" accept=".json" onChange={e => handleUpload(e, 'dg')} />
              <p className="upload-hint">格式：["词1", "词2", "词3", ...]</p>
            </div>
          )}

          {(dgWordSource === 'bangumi' || mode === 'aiguess') && (
            <div className="bgm-settings">
              <div className="setting-row" style={{ alignItems: 'flex-start' }}>
                <span style={{ paddingTop: '2px' }}>条目类型</span>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {[{v:2,l:'动画'},{v:4,l:'游戏'},{v:1,l:'书籍'},{v:6,l:'三次元'},{v:3,l:'音乐'}].map(opt => (
                    <label key={opt.v} style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input
                        type="checkbox"
                        checked={bgmType.includes(opt.v)}
                        onChange={e => {
                          const next = e.target.checked ? [...bgmType, opt.v] : bgmType.filter(t => t !== opt.v);
                          if (next.length === 0) return;
                          setBgmType(next);
                          sync({ bgmType: next });
                        }}
                      />
                      {opt.l}
                    </label>
                  ))}
                </div>
              </div>
              <div className="setting-row">
                <span>关键词</span>
                <input
                  type="text"
                  className="bgm-input"
                  value={bgmKeyword}
                  placeholder="可留空"
                  onChange={e => setBgmKeyword(e.target.value)}
                  onBlur={() => sync({})}
                />
              </div>
              <div className="setting-row">
                <span>年份</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="number"
                    className="bgm-input"
                    value={bgmYear}
                    placeholder="起始"
                    min={1990}
                    max={2030}
                    style={{ width: '70px' }}
                    onChange={e => setBgmYear(e.target.value)}
                    onBlur={() => sync({})}
                  />
                  <span style={{ color: 'var(--text-muted)' }}>—</span>
                  <input
                    type="number"
                    className="bgm-input"
                    value={bgmYearEnd}
                    placeholder="结束"
                    min={1990}
                    max={2030}
                    style={{ width: '70px' }}
                    onChange={e => setBgmYearEnd(e.target.value)}
                    onBlur={() => sync({})}
                  />
                </div>
              </div>
              <div className="setting-row">
                <span>月份</span>
                <select value={bgmMonth} onChange={e => { setBgmMonth(e.target.value); sync({ bgmMonth: e.target.value }); }}>
                  <option value="">不限</option>
                  <option value="1">1月</option>
                  <option value="4">4月</option>
                  <option value="7">7月</option>
                  <option value="10">10月</option>
                </select>
              </div>
              <div className="setting-row">
                <span>标签</span>
                <input
                  type="text"
                  className="bgm-input"
                  value={bgmTag}
                  placeholder="逗号分隔，如 原创,校园"
                  onChange={e => setBgmTag(e.target.value)}
                  onBlur={() => sync({})}
                />
              </div>
              <div className="setting-row">
                <span>排序</span>
                <select value={bgmSort} onChange={e => { setBgmSort(e.target.value); sync({ bgmSort: e.target.value }); }}>
                  <option value="rank">排名</option>
                  <option value="score">评分</option>
                  <option value="heat">热度</option>
                  <option value="match">匹配度</option>
                </select>
              </div>
              <div className="setting-row">
                <span>排名上限</span>
                <select value={bgmRankMax} onChange={e => { setBgmRankMax(e.target.value); sync({ bgmRankMax: e.target.value }); }}>
                  <option value="">不限</option>
                  <option value="100">前 100</option>
                  <option value="200">前 200</option>
                  <option value="500">前 500</option>
                  <option value="1000">前 1000</option>
                </select>
              </div>
              <div className="setting-row">
                <span>排名下限</span>
                <select value={bgmRankMin} onChange={e => { setBgmRankMin(e.target.value); sync({ bgmRankMin: e.target.value }); }}>
                  <option value="">不限</option>
                  <option value="10">10 名以外</option>
                  <option value="20">20 名以外</option>
                  <option value="50">50 名以外</option>
                  <option value="100">100 名以外</option>
                </select>
              </div>
              <div className="setting-row">
                <span>最低评分</span>
                <select value={bgmRatingMin} onChange={e => { setBgmRatingMin(e.target.value); sync({ bgmRatingMin: e.target.value }); }}>
                  <option value="">不限</option>
                  <option value="6">6 分以上</option>
                  <option value="7">7 分以上</option>
                  <option value="8">8 分以上</option>
                </select>
              </div>
              <div className="setting-row">
                <span>最低热度</span>
                <select value={bgmRatingCountMin} onChange={e => { setBgmRatingCountMin(e.target.value); sync({ bgmRatingCountMin: e.target.value }); }}>
                  <option value="">不限</option>
                  <option value="500">500 人以上</option>
                  <option value="1000">1000 人以上</option>
                  <option value="5000">5000 人以上</option>
                  <option value="10000">10000 人以上</option>
                </select>
              </div>
              <p className="upload-hint">开始游戏时将从 Bangumi 获取动画名称作为词库</p>
            </div>
          )}
        </div>
      ) : (
        <div>
          <div className="setting-row">
            <span>卧底</span>
            <select value={ucCount} onChange={e => { setUcCount(+e.target.value); sync({ undercoverCount: +e.target.value }); }}>
              {[1,2,3].map(n => <option key={n} value={n}>{n}人</option>)}
            </select>
          </div>
          <div className="setting-row">
            <span>天使</span>
            <select value={angelCount} onChange={e => { setAngelCount(+e.target.value); sync({ angelCount: +e.target.value }); }}>
              {[0,1,2].map(n => <option key={n} value={n}>{n}人</option>)}
            </select>
          </div>
          <div className="setting-row">
            <span>白板</span>
            <select value={blankCount} onChange={e => { setBlankCount(+e.target.value); sync({ blankCount: +e.target.value }); }}>
              {[0,1,2].map(n => <option key={n} value={n}>{n}人</option>)}
            </select>
          </div>
          <div className="setting-divider"></div>
          <div className="setting-row">
            <span>词源</span>
            <select value={wordSource} onChange={e => { setWordSource(e.target.value); sync({ wordSource: e.target.value }); }}>
              <option value="builtin">内置词库</option>
              <option value="upload">上传词库</option>
              <option value="angel">天使出词</option>
            </select>
          </div>
          {wordSource === 'upload' && (
            <div className="upload-area">
              <label className="btn btn-ghost upload-btn">
                选择JSON文件
                <input type="file" accept=".json" hidden onChange={e => handleUpload(e, 'uc')} />
              </label>
              <p className="upload-hint">格式: [["词A","词B"], ...]</p>
            </div>
          )}
          <div className="setting-divider"></div>
          <div className="setting-row">
            <span>白天时长</span>
            <select value={dayTimer} onChange={e => { setDayTimer(+e.target.value); sync({ dayTimer: +e.target.value }); }}>
              {[[60,'60秒'],[90,'90秒'],[120,'120秒'],[180,'3分钟'],[300,'5分钟'],[600,'10分钟'],[900,'15分钟'],[9999,'不限时']].map(([v,l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="setting-row">
            <span>夜晚时长</span>
            <select value={nightTimer} onChange={e => { setNightTimer(+e.target.value); sync({ nightTimer: +e.target.value }); }}>
              {[[15,'15秒'],[30,'30秒'],[45,'45秒'],[60,'60秒'],[90,'90秒'],[120,'2分钟'],[300,'5分钟'],[9999,'不限时']].map(([v,l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="setting-row">
            <span>投票时长</span>
            <select value={voteTimer} onChange={e => { setVoteTimer(+e.target.value); sync({ voteTimer: +e.target.value }); }}>
              {[[15,'15秒'],[30,'30秒'],[45,'45秒'],[60,'60秒'],[90,'90秒'],[120,'2分钟'],[300,'5分钟'],[9999,'不限时']].map(([v,l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
        </div>
      )}

      <button className="btn btn-accent full-width mt" onClick={() => emit('startGame')}>开始游戏</button>
    </div>
  );
}
