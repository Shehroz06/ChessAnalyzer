import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import toast from 'react-hot-toast';

import EvalBar    from '../components/EvalBar.jsx';
import EvalGraph  from '../components/EvalGraph.jsx';
import MoveList   from '../components/MoveList.jsx';
import GameSummary from '../components/GameSummary.jsx';
import { analyzeGameStream } from '../utils/api.js';
import { useBoardSize } from '../utils/useBoardSize.js';
import { uciToSquares, CLASSIFICATION_META } from '../utils/chess.js';

/* ── helpers ─────────────────────────────────────────────────────────────── */
function formatEvalCp(cp) {
  if (cp === undefined || cp === null) return '';
  const abs = Math.abs(cp);
  if (abs >= 99_000) {
    const m = (abs - 99_000) || 1;
    return cp > 0 ? `M+${m}` : `M-${m}`;
  }
  const v = (cp / 100).toFixed(1);
  return cp >= 0 ? `+${v}` : `${v}`;
}

function computePvFen(fenBefore, pvUci, upToIndex) {
  try {
    const g = new Chess(fenBefore);
    for (let i = 0; i <= upToIndex && i < pvUci.length; i++) {
      const uci = pvUci[i];
      g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] ?? 'q' });
    }
    return g.fen();
  } catch {
    return fenBefore;
  }
}

function computeAltPreview(fenBefore, san) {
  try {
    const g    = new Chess(fenBefore);
    const move = g.move(san);
    const uci  = move.from + move.to + (move.promotion ?? '');
    return { fen: g.fen(), uci };
  } catch { return null; }
}

/* ── constants ───────────────────────────────────────────────────────────── */
const START_FEN   = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMO_GLYPH = { q: '♛', r: '♜', b: '♝', n: '♞' };
const CLS_ARROW = {
  Brilliant:  '#1bada6',
  Great:      '#4b88e3',
  Book:       '#a0a0c0',
  Best:       '#00a67e',
  Excellent:  '#96bc4b',
  Good:       '#7fc37e',
  Inaccuracy: '#f0c15f',
  Mistake:    '#e08030',
  Miss:       '#c87000',
  Blunder:    '#ca3431',
};
const PLAY_DELAY  = 1000;

function getSquareBadgePos(square, boardSize, isFlipped) {
  const squareSize = boardSize / 8;
  const fileIdx    = 'abcdefgh'.indexOf(square[0]);
  const rankIdx    = parseInt(square[1]) - 1;
  const left = isFlipped ? (7 - fileIdx) * squareSize : fileIdx * squareSize;
  const top  = isFlipped ? rankIdx * squareSize        : (7 - rankIdx) * squareSize;
  return { left: left + squareSize * 0.58, top: top + squareSize * 0.60 };
}

/* ── component ───────────────────────────────────────────────────────────── */
export default function AnalysisPage() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const boardSize = useBoardSize();

  const [analysisData, setAnalysisData]         = useState(location.state?.analysisData ?? null);
  const [currentIndex, setCurrentIndex]         = useState(-1);
  const [boardOrientation, setBoardOrientation] = useState('white');
  const [showBestMove, setShowBestMove]         = useState(true);
  const [sidebarTab, setSidebarTab]             = useState('moves');
  const [sidebarOpen, setSidebarOpen]           = useState(true);
  const [isPlaying, setIsPlaying]               = useState(false);
  const [loading, setLoading]                   = useState(false);
  const [progress, setProgress]                 = useState(null);
  const [aiLoading, setAiLoading]               = useState(false);
  const [aiCommentary, setAiCommentary]         = useState(null);
  // pvPreview: null | { fenBefore, pvUci, pvSan, activeIndex }
  const [pvPreview, setPvPreview]               = useState(null);

  const playTimerRef = useRef(null);

  /* secondary load (from PlayPage "Review Game") */
  useEffect(() => {
    const { pgn, gameId, depth } = location.state ?? {};
    if (!analysisData && (pgn || gameId)) {
      setLoading(true);
      analyzeGameStream(
        { pgn, gameId, depth: depth ?? 11 },
        (c, t) => setProgress({ current: c, total: t }),
      )
        .then(setAnalysisData)
        .catch(e => toast.error(e?.message ?? 'Analysis failed'))
        .finally(() => { setLoading(false); setProgress(null); });
    }
  }, []);

  /* clear AI commentary and PV preview when move changes */
  useEffect(() => {
    setAiCommentary(null);
    setPvPreview(null);
  }, [currentIndex]);

  /* ── derived ─────────────────────────────────────────────────────────── */
  const moves   = analysisData?.moves ?? [];
  const current = currentIndex >= 0 ? moves[currentIndex] : null;
  const fen     = current?.fen_after ?? (moves[0]?.fen_before ?? START_FEN);
  const evalCp  = current?.eval_cp ?? Math.round((analysisData?.initial_eval ?? 0) * 100);
  const clsMeta = current ? CLASSIFICATION_META[current.classification] : null;
  const playedPromo = current?.move_uci?.length === 5 ? PROMO_GLYPH[current.move_uci[4]] : null;
  const bestPromo   = current?.best_move_uci?.length === 5 ? PROMO_GLYPH[current.best_move_uci[4]] : null;
  const isFlipped   = boardOrientation === 'black';

  /* ── PV-preview derived ──────────────────────────────────────────────── */
  const displayFen = pvPreview
    ? computePvFen(pvPreview.fenBefore, pvPreview.pvUci, pvPreview.activeIndex)
    : fen;

  const displayArrows = (() => {
    if (pvPreview) {
      const uci = pvPreview.pvUci[pvPreview.activeIndex];
      if (!uci) return [];
      const sq = uciToSquares(uci);
      return sq ? [[sq[0], sq[1], '#00a67e']] : [];
    }
    const arr = [];
    if (current) {
      const p = uciToSquares(current.move_uci);
      if (p) arr.push([p[0], p[1], CLS_ARROW[current.classification] ?? '#60a5fa']);
      if (showBestMove && current.best_move_uci && current.best_move_uci !== current.move_uci) {
        const b = uciToSquares(current.best_move_uci);
        if (b) arr.push([b[0], b[1], '#00a67e']);
      }
    }
    return arr;
  })();

  /* badge shows only in game mode, not PV preview */
  const squareStyles = {};
  if (current && !pvPreview) {
    const p = uciToSquares(current.move_uci);
    if (p) {
      const bg = (clsMeta?.color ?? '#60a5fa') + '33';
      squareStyles[p[0]] = { backgroundColor: bg };
      squareStyles[p[1]] = { backgroundColor: bg };
    }
  }
  const destSquare = (!pvPreview && current) ? uciToSquares(current.move_uci)?.[1] : null;
  const badgePos   = destSquare ? getSquareBadgePos(destSquare, boardSize, isFlipped) : null;
  const squareSize = boardSize / 8;
  const badgeSize  = Math.max(18, squareSize * 0.36);

  /* ── navigation ──────────────────────────────────────────────────────── */
  const goTo = useCallback((idx) => {
    setPvPreview(null);
    setCurrentIndex(Math.max(-1, Math.min(moves.length - 1, idx)));
  }, [moves.length]);

  function openPvPreview(moveIndex) {
    if (!current?.pv_uci?.length) return;
    setIsPlaying(false);
    setPvPreview({
      fenBefore:   current.fen_before,
      pvUci:       current.pv_uci,
      pvSan:       current.pv_san,
      activeIndex: Math.min(moveIndex, current.pv_uci.length - 1),
    });
  }

  /* keyboard navigation */
  useEffect(() => {
    const h = e => {
      /* PV preview mode — arrows step through the engine line */
      if (pvPreview) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPvPreview(p => p && p.activeIndex < p.pvSan.length - 1
            ? { ...p, activeIndex: p.activeIndex + 1 } : p);
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (pvPreview.activeIndex === 0) setPvPreview(null);
          else setPvPreview(p => p ? { ...p, activeIndex: p.activeIndex - 1 } : p);
        }
        if (e.key === 'Escape') setPvPreview(null);
        return;
      }
      /* normal game navigation */
      if (e.key === 'ArrowRight') { setIsPlaying(false); goTo(currentIndex + 1); }
      if (e.key === 'ArrowLeft')  { setIsPlaying(false); goTo(currentIndex - 1); }
      if (e.key === 'Home')       { setIsPlaying(false); goTo(-1); }
      if (e.key === 'End')        { setIsPlaying(false); goTo(moves.length - 1); }
      if (e.key === ' ')          { e.preventDefault(); togglePlay(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [currentIndex, goTo, moves.length, isPlaying, pvPreview]);

  /* ── auto-play ───────────────────────────────────────────────────────── */
  useEffect(() => {
    clearTimeout(playTimerRef.current);
    if (!isPlaying) return;
    if (currentIndex >= moves.length - 1) { setIsPlaying(false); return; }
    playTimerRef.current = setTimeout(() => {
      setCurrentIndex(i => Math.min(i + 1, moves.length - 1));
    }, PLAY_DELAY);
    return () => clearTimeout(playTimerRef.current);
  }, [isPlaying, currentIndex, moves.length]);

  function togglePlay() {
    if (isPlaying) { setIsPlaying(false); return; }
    if (currentIndex >= moves.length - 1) goTo(-1);
    setIsPlaying(true);
  }

  /* ── board orientation helpers ───────────────────────────────────────── */
  const topColor  = isFlipped ? 'white' : 'black';
  const btmColor  = isFlipped ? 'black' : 'white';
  const topName   = analysisData?.headers?.[topColor === 'white' ? 'White' : 'Black'] ?? topColor;
  const btmName   = analysisData?.headers?.[btmColor === 'white' ? 'White' : 'Black'] ?? btmColor;
  const topAcc    = topColor  === 'white' ? analysisData?.accuracy_white : analysisData?.accuracy_black;
  const btmAcc    = btmColor  === 'white' ? analysisData?.accuracy_white : analysisData?.accuracy_black;
  const topCounts = topColor  === 'white' ? analysisData?.counts_white   : analysisData?.counts_black;
  const btmCounts = btmColor  === 'white' ? analysisData?.counts_white   : analysisData?.counts_black;

  /* ── AI commentary (Ollama) ──────────────────────────────────────────── */
  async function fetchAiCommentary() {
    if (!current) return;
    setAiLoading(true);
    try {
      const resp = await fetch('/api/commentary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen_before:     current.fen_before,
          move_san:       current.move,
          move_uci:       current.move_uci,
          classification: current.classification,
          cp_loss:        current.cp_loss,
          best_move:      current.best_move,
          pv_san:         current.pv_san ?? [],
          player:         current.player,
          is_sacrifice:   current.is_sacrifice,
        }),
      });
      if (!resp.ok) throw new Error('AI unavailable');
      const data = await resp.json();
      setAiCommentary(data.commentary);
    } catch {
      toast.error('AI commentary unavailable. Is Ollama running?');
    } finally {
      setAiLoading(false);
    }
  }

  /* ── loading screen ──────────────────────────────────────────────────── */
  if (loading) {
    const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] gap-6 px-4"
           style={{ background: 'var(--t-bg)' }}>
        <div className="text-6xl select-none animate-bounce">♟</div>
        <p className="font-semibold text-lg" style={{ color: 'var(--t-text)' }}>
          {progress ? `Analyzing move ${progress.current} of ${progress.total}` : 'Fetching game…'}
        </p>
        {progress && (
          <div className="w-72 space-y-1.5">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--t-surf2)' }}>
              <div className="h-full rounded-full transition-all duration-200"
                   style={{ width: `${pct}%`, background: 'var(--t-green)' }} />
            </div>
            <p className="text-center text-xs" style={{ color: 'var(--t-muted)' }}>{pct}% complete</p>
          </div>
        )}
      </div>
    );
  }

  if (!analysisData) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-56px)] gap-4"
           style={{ background: 'var(--t-bg)' }}>
        <p style={{ color: 'var(--t-muted)' }}>No analysis loaded.</p>
        <button onClick={() => navigate('/')} className="px-5 py-2 rounded-lg text-sm text-white"
                style={{ background: 'var(--t-green)' }}>← Go Home</button>
      </div>
    );
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-[calc(100vh-56px)]" style={{ background: 'var(--t-bg)' }}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-center gap-3 p-3 lg:p-4">

        {/* ── BOARD COLUMN ─────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">

          <PlayerCard name={topName} color={topColor} accuracy={topAcc} counts={topCounts} width={boardSize} />

          {/* PV preview banner */}
          {pvPreview && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg text-xs gap-2"
                 style={{ width: boardSize, background: '#00a67e18', border: '1px solid #00a67e55' }}>
              <span style={{ color: '#00a67e', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Engine line: {pvPreview.pvSan.slice(0, pvPreview.activeIndex + 1).join(' · ')}
              </span>
              <button onClick={() => setPvPreview(null)}
                      className="flex-shrink-0 text-xs px-2 py-0.5 rounded"
                      style={{ background: 'var(--t-surf2)', color: 'var(--t-muted)', border: '1px solid var(--t-border)' }}>
                ✕ Back
              </button>
            </div>
          )}

          {/* Eval bar + board */}
          <div className="flex gap-2 items-stretch">
            <EvalBar evalCp={evalCp} orientation={boardOrientation} height={`${boardSize}px`} />

            <div style={{ width: boardSize, height: boardSize, position: 'relative' }}>
              <Chessboard
                position={displayFen}
                boardOrientation={boardOrientation}
                customArrows={displayArrows}
                customSquareStyles={squareStyles}
                arePiecesDraggable={false}
                animationDuration={isPlaying ? 80 : 150}
                customBoardStyle={{ borderRadius: '6px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
                customDarkSquareStyle={{ backgroundColor: '#769656' }}
                customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
              />

              {/* Classification badge (game mode only) */}
              {!pvPreview && current && clsMeta && badgePos && (
                <div style={{
                  position: 'absolute', left: badgePos.left, top: badgePos.top,
                  width: badgeSize, height: badgeSize, borderRadius: '50%',
                  backgroundColor: clsMeta.color, border: '2px solid rgba(0,0,0,0.35)',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.55)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: badgeSize * 0.48, color: '#fff', fontWeight: 700,
                  zIndex: 20, pointerEvents: 'none', userSelect: 'none', lineHeight: 1,
                }}>
                  {clsMeta.symbol}
                </div>
              )}
            </div>
          </div>

          <PlayerCard name={btmName} color={btmColor} accuracy={btmAcc} counts={btmCounts} width={boardSize} />

          {/* ── Navigation row ────────────────────────────────────────── */}
          <div className="flex items-center gap-1" style={{ width: boardSize }}>

            <NavBtn
              onClick={() => { setPvPreview(null); setIsPlaying(false); goTo(-1); }}
              title="Go to start"
            >⏮</NavBtn>

            {/* Prev — exact < */}
            <NavBtn
              onClick={() => {
                if (pvPreview) {
                  if (pvPreview.activeIndex === 0) setPvPreview(null);
                  else setPvPreview(p => p ? { ...p, activeIndex: p.activeIndex - 1 } : p);
                } else {
                  setIsPlaying(false); goTo(currentIndex - 1);
                }
              }}
              title={pvPreview ? 'Previous engine move' : 'Previous move (←)'}
            >
              <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{'<'}</span>
            </NavBtn>

            {/* Play / Pause */}
            <NavBtn onClick={togglePlay} title={isPlaying ? 'Pause (Space)' : 'Auto-play (Space)'} active={isPlaying}>
              {isPlaying ? '⏸' : '▶'}
            </NavBtn>

            {/* Next — exact > */}
            <NavBtn
              onClick={() => {
                if (pvPreview) {
                  setPvPreview(p => p && p.activeIndex < p.pvSan.length - 1
                    ? { ...p, activeIndex: p.activeIndex + 1 } : p);
                } else {
                  setIsPlaying(false); goTo(currentIndex + 1);
                }
              }}
              title={pvPreview ? 'Next engine move' : 'Next move (→)'}
            >
              <span style={{ fontSize: 22, fontWeight: 800, lineHeight: 1 }}>{'>'}</span>
            </NavBtn>

            <NavBtn onClick={() => { setPvPreview(null); setIsPlaying(false); goTo(moves.length - 1); }} title="Go to end">⏭</NavBtn>

            <div className="flex-1" />

            <label className="flex items-center gap-1 text-xs cursor-pointer select-none"
                   style={{ color: 'var(--t-muted)' }} title="Show best move arrow">
              <input type="checkbox" checked={showBestMove}
                     onChange={e => setShowBestMove(e.target.checked)}
                     className="accent-[var(--t-green)] w-3 h-3" />
              Best
            </label>

            <NavBtn onClick={() => setBoardOrientation(o => o === 'white' ? 'black' : 'white')} title="Flip board">⇅</NavBtn>

            <NavBtn onClick={() => setSidebarOpen(o => !o)} title={sidebarOpen ? 'Close panel' : 'Open panel'} active={sidebarOpen}>
              {sidebarOpen ? '⊡' : '⊞'}
            </NavBtn>
          </div>

          {/* Progress scrubber */}
          {moves.length > 0 && (
            <div style={{ width: boardSize }}>
              <div className="h-0.5 rounded-full cursor-pointer" style={{ background: 'var(--t-surf2)' }}
                   onClick={e => {
                     const rect = e.currentTarget.getBoundingClientRect();
                     const pct  = (e.clientX - rect.left) / rect.width;
                     setIsPlaying(false); goTo(Math.round(pct * (moves.length - 1)) - 1);
                   }}>
                <div className="h-full rounded-full"
                     style={{
                       width:      `${((currentIndex + 1) / moves.length) * 100}%`,
                       background: isPlaying ? 'var(--t-green)' : 'var(--t-surf3)',
                       transition: isPlaying ? 'width 0.9s linear' : 'width 0.15s',
                     }} />
              </div>
            </div>
          )}

        </div>

        {/* ── SIDEBAR ──────────────────────────────────────────────────── */}
        {sidebarOpen ? (
          <div className="flex flex-col rounded-lg overflow-hidden border lg:sticky lg:top-[68px] w-full lg:w-[300px] lg:flex-shrink-0"
               style={{ maxHeight: 'calc(100vh - 76px)', background: 'var(--t-surf)', borderColor: 'var(--t-border)' }}>

            {/* Current move banner */}
            {current ? (
              <div className="flex items-center gap-2.5 px-3 py-2.5 flex-shrink-0 border-b"
                   style={{ borderLeftWidth: 4, borderLeftColor: clsMeta?.color ?? 'var(--t-green)', borderBottomColor: 'var(--t-border)' }}>
                <span className="text-base font-bold font-mono" style={{ color: 'var(--t-text)' }}>
                  {current.move}{playedPromo ?? ''}
                </span>
                <span className="text-sm font-semibold px-1.5 py-0.5 rounded"
                      style={{ color: clsMeta?.color, background: (clsMeta?.color ?? '#888') + '22' }}>
                  {clsMeta?.symbol} {current.classification}
                </span>
                {current.cp_loss > 0 && (
                  <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--t-muted)' }}>
                    -{(current.cp_loss / 100).toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              <div className="h-1 flex-shrink-0" style={{ background: 'var(--t-green)' }} />
            )}

            {/* Best move + clickable alternatives (hidden for Book moves) */}
            {current?.best_move && current.best_move !== current.move && current?.classification !== 'Book' && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 border-b flex-shrink-0 flex-wrap"
                   style={{ background: 'var(--t-surf2)', borderColor: 'var(--t-border)' }}>
                <span className="text-xs" style={{ color: 'var(--t-muted)' }}>Best</span>
                <button
                  onClick={() => openPvPreview(0)}
                  className="text-sm font-mono font-bold transition-colors"
                  style={{
                    color: 'var(--t-green)',
                    textDecoration: 'underline',
                    textDecorationStyle: 'dotted',
                    textUnderlineOffset: '2px',
                  }}
                  title="View best move on board"
                >
                  {current.best_move}{bestPromo ?? ''}
                </button>
                {current.alternatives?.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      const result = computeAltPreview(current.fen_before, a.move);
                      if (result) setPvPreview({ fenBefore: current.fen_before, pvUci: [result.uci], pvSan: [a.move], activeIndex: 0 });
                    }}
                    className="text-xs font-mono transition-colors"
                    style={{ color: 'var(--t-text2)' }}
                    title={`View ${a.move} on board`}
                  >
                    · {a.move}
                  </button>
                ))}
              </div>
            )}

            {/* Commentary + PV section */}
            {current && (
              <div className="px-3 py-2.5 border-b flex-shrink-0 space-y-2.5" style={{ borderColor: 'var(--t-border)' }}>
                {current.commentary && (
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--t-text2)' }}>
                    {current.commentary}
                  </p>
                )}

                {/* Best line — each move is clickable (hidden for Book moves) */}
                {current.pv_san?.length > 0 && current?.classification !== 'Book' && (
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs" style={{ color: 'var(--t-muted)' }}>Best line</span>
                      {current.eval_best_cp !== undefined && (
                        <span className="text-xs font-mono font-bold px-1 py-0.5 rounded"
                              style={{
                                background: current.eval_best_cp >= 0 ? 'rgba(255,255,255,0.06)' : 'rgba(200,50,50,0.15)',
                                color:      current.eval_best_cp >= 0 ? '#94a3b8' : '#f87171',
                              }}>
                          {formatEvalCp(current.eval_best_cp)}
                        </span>
                      )}
                    </div>
                    <div className="flex gap-1 overflow-x-auto pb-0.5" style={{ scrollbarWidth: 'none' }}>
                      {current.pv_san.slice(0, 6).map((san, i) => (
                        <button
                          key={i}
                          onClick={() => openPvPreview(i)}
                          className="text-xs font-mono px-1.5 py-0.5 rounded transition-all flex-shrink-0"
                          style={{
                            background: pvPreview?.activeIndex === i ? '#00a67e22' : 'var(--t-surf3)',
                            color:      pvPreview?.activeIndex === i ? '#00a67e'   : 'var(--t-text2)',
                            border:     pvPreview?.activeIndex === i ? '1px solid #00a67e66' : '1px solid transparent',
                            fontWeight: i === 0 ? 700 : 400,
                            cursor:     'pointer',
                          }}
                          title={`Step to position after ${san}`}
                        >
                          {san}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* AI commentary */}
                {aiCommentary ? (
                  <div className="rounded-lg p-2.5 text-xs leading-relaxed"
                       style={{ background: 'var(--t-surf2)', color: 'var(--t-text2)' }}>
                    <span className="font-semibold text-xs block mb-1" style={{ color: 'var(--t-green)' }}>
                      AI Analysis
                    </span>
                    {aiCommentary}
                  </div>
                ) : (
                  <button onClick={fetchAiCommentary} disabled={aiLoading}
                          className="w-full py-1.5 text-xs rounded-lg border transition-colors"
                          style={{ borderColor: 'var(--t-border)', background: 'var(--t-surf2)', color: aiLoading ? 'var(--t-muted)' : 'var(--t-text2)' }}>
                    {aiLoading ? 'Thinking…' : 'Get AI Commentary'}
                  </button>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b flex-shrink-0" style={{ borderColor: 'var(--t-border)' }}>
              {[['moves', 'Moves'], ['graph', 'Graph'], ['summary', 'Summary']].map(([key, label]) => (
                <button key={key} onClick={() => setSidebarTab(key)}
                        className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
                        style={{
                          color:        sidebarTab === key ? 'var(--t-text)' : 'var(--t-muted)',
                          borderBottom: sidebarTab === key ? '2px solid var(--t-green)' : '2px solid transparent',
                        }}>
                  {label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {sidebarTab === 'moves' && (
                <MoveList moves={moves} currentIndex={currentIndex}
                          onSelect={idx => { setPvPreview(null); setIsPlaying(false); goTo(idx); }} />
              )}
              {sidebarTab === 'graph' && (
                <div className="p-3">
                  <EvalGraph moves={moves} initialWinProb={analysisData.initial_win_prob ?? 0.5}
                             currentIndex={currentIndex}
                             onSelect={idx => { setPvPreview(null); setIsPlaying(false); goTo(idx); }} />
                  <p className="text-xs text-center mt-2" style={{ color: 'var(--t-muted)' }}>
                    Click to jump to any move
                  </p>
                </div>
              )}
              {sidebarTab === 'summary' && (
                <div className="p-3"><GameSummary analysisData={analysisData} /></div>
              )}
            </div>

            <button onClick={() => setSidebarOpen(false)}
                    className="flex-shrink-0 w-full py-1.5 text-xs transition-colors border-t flex items-center justify-center gap-1"
                    style={{ color: 'var(--t-muted)', background: 'var(--t-surf2)', borderColor: 'var(--t-border)' }}>
              ⊡ Close panel
            </button>
          </div>
        ) : (
          <button onClick={() => setSidebarOpen(true)}
                  className="hidden lg:flex flex-col items-center justify-center gap-1 rounded-lg border transition-colors lg:sticky lg:top-[68px] flex-shrink-0"
                  title="Open panel"
                  style={{ width: 36, height: 120, background: 'var(--t-surf)', borderColor: 'var(--t-border)', color: 'var(--t-muted)' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'var(--t-surf2)'; e.currentTarget.style.color = 'var(--t-text)'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'var(--t-surf)';  e.currentTarget.style.color = 'var(--t-muted)'; }}>
            <span style={{ fontSize: 16 }}>⊞</span>
            <span style={{ fontSize: 9, writingMode: 'vertical-rl', letterSpacing: 1 }}>PANEL</span>
          </button>
        )}

      </div>
    </div>
  );
}

/* ── sub-components ──────────────────────────────────────────────────────── */

function PlayerCard({ name, color, accuracy, counts = {}, width }) {
  const initial  = (name ?? '?')[0].toUpperCase();
  const brills   = counts.Brilliant  ?? 0;
  const blunders = counts.Blunder    ?? 0;
  const mistakes = counts.Mistake    ?? 0;
  const inaccs   = counts.Inaccuracy ?? 0;

  return (
    <div className="flex items-center gap-2.5 px-1" style={{ width }}>
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
           style={{ background: color === 'white' ? '#e5e7eb' : '#374151', color: color === 'white' ? '#1f2937' : '#f9fafb' }}>
        {initial}
      </div>
      <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--t-text)' }}>{name}</span>
      <div className="flex items-center gap-2 text-xs flex-shrink-0 font-mono">
        {brills   > 0 && <span style={{ color: '#1bada6' }}>!! {brills}</span>}
        {blunders > 0 && <span style={{ color: '#ca3431' }}>?? {blunders}</span>}
        {mistakes > 0 && <span style={{ color: '#e08030' }}>? {mistakes}</span>}
        {inaccs   > 0 && <span style={{ color: '#f0c15f' }}>?! {inaccs}</span>}
        {accuracy !== undefined && (
          <span style={{ color: 'var(--t-green)', fontWeight: 700 }} className="ml-1">{accuracy}%</span>
        )}
      </div>
    </div>
  );
}

function NavBtn({ onClick, title, children, active = false }) {
  return (
    <button onClick={onClick} title={title}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-base transition-colors font-bold flex-shrink-0"
            style={{
              background: active ? 'var(--t-surf3)' : 'var(--t-surf2)',
              color:      active ? 'var(--t-text)'  : 'var(--t-text2)',
              border:     active ? '1px solid var(--t-green)' : '1px solid transparent',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = 'var(--t-surf3)'; e.currentTarget.style.color = 'var(--t-text)'; }}
            onMouseLeave={e => {
              e.currentTarget.style.background = active ? 'var(--t-surf3)' : 'var(--t-surf2)';
              e.currentTarget.style.color      = active ? 'var(--t-text)'  : 'var(--t-text2)';
            }}>
      {children}
    </button>
  );
}
