import { useState, useEffect, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import toast from 'react-hot-toast';

import EvalBar    from '../components/EvalBar.jsx';
import EvalGraph  from '../components/EvalGraph.jsx';
import MoveList   from '../components/MoveList.jsx';
import GameSummary from '../components/GameSummary.jsx';
import { analyzeGameStream } from '../utils/api.js';
import { useBoardSize } from '../utils/useBoardSize.js';
import { uciToSquares, CLASSIFICATION_META } from '../utils/chess.js';

/* ── constants ───────────────────────────────────────────────────────────── */
const START_FEN   = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PROMO_GLYPH = { q: '♛', r: '♜', b: '♝', n: '♞' };
const CLS_ARROW   = { Brilliant: '#1bada6', Blunder: '#ca3431', Mistake: '#e08030', Inaccuracy: '#f0c15f' };

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
  const [loading, setLoading]                   = useState(false);
  const [progress, setProgress]                 = useState(null);

  /* secondary load (from PlayPage "Review Game") */
  useEffect(() => {
    const { pgn, gameId, depth } = location.state ?? {};
    if (!analysisData && (pgn || gameId)) {
      setLoading(true);
      analyzeGameStream(
        { pgn, gameId, depth: depth ?? 12 },
        (c, t) => setProgress({ current: c, total: t }),
      )
        .then(setAnalysisData)
        .catch(e => toast.error(e?.message ?? 'Analysis failed'))
        .finally(() => { setLoading(false); setProgress(null); });
    }
  }, []);

  /* ── derived ─────────────────────────────────────────────────────────── */
  const moves   = analysisData?.moves ?? [];
  const current = currentIndex >= 0 ? moves[currentIndex] : null;
  const fen     = current?.fen_after ?? (moves[0]?.fen_before ?? START_FEN);
  const evalCp  = current?.eval_cp ?? Math.round((analysisData?.initial_eval ?? 0) * 100);
  const clsMeta = current ? CLASSIFICATION_META[current.classification] : null;
  const playedPromo = current?.move_uci?.length === 5 ? PROMO_GLYPH[current.move_uci[4]] : null;
  const bestPromo   = current?.best_move_uci?.length === 5 ? PROMO_GLYPH[current.best_move_uci[4]] : null;

  /* ── arrows / highlights ─────────────────────────────────────────────── */
  const arrows = [];
  if (current) {
    const p = uciToSquares(current.move_uci);
    if (p) arrows.push([p[0], p[1], CLS_ARROW[current.classification] ?? '#60a5fa']);
    if (showBestMove && current.best_move_uci && current.best_move_uci !== current.move_uci) {
      const b = uciToSquares(current.best_move_uci);
      if (b) arrows.push([b[0], b[1], '#00a67e']);
    }
  }
  const squareStyles = {};
  if (current) {
    const p = uciToSquares(current.move_uci);
    if (p) {
      const bg = (clsMeta?.color ?? '#60a5fa') + '33';
      squareStyles[p[0]] = { backgroundColor: bg };
      squareStyles[p[1]] = { backgroundColor: bg };
    }
  }

  /* ── navigation ──────────────────────────────────────────────────────── */
  const goTo = useCallback((idx) => {
    setCurrentIndex(Math.max(-1, Math.min(moves.length - 1, idx)));
  }, [moves.length]);

  useEffect(() => {
    const h = e => {
      if (e.key === 'ArrowRight') goTo(currentIndex + 1);
      if (e.key === 'ArrowLeft')  goTo(currentIndex - 1);
      if (e.key === 'Home')       goTo(-1);
      if (e.key === 'End')        goTo(moves.length - 1);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [currentIndex, goTo, moves.length]);

  /* ── board orientation helpers ───────────────────────────────────────── */
  const isFlipped   = boardOrientation === 'black';
  const topColor    = isFlipped ? 'white' : 'black';
  const btmColor    = isFlipped ? 'black' : 'white';
  const topName     = analysisData?.headers?.[topColor === 'white' ? 'White' : 'Black']  ?? topColor;
  const btmName     = analysisData?.headers?.[btmColor === 'white' ? 'White' : 'Black']  ?? btmColor;
  const topAcc      = topColor  === 'white' ? analysisData?.accuracy_white : analysisData?.accuracy_black;
  const btmAcc      = btmColor  === 'white' ? analysisData?.accuracy_white : analysisData?.accuracy_black;
  const topCounts   = topColor  === 'white' ? analysisData?.counts_white   : analysisData?.counts_black;
  const btmCounts   = btmColor  === 'white' ? analysisData?.counts_white   : analysisData?.counts_black;

  /* ── loading ─────────────────────────────────────────────────────────── */
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
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${pct}%`, background: 'var(--t-green)' }}
              />
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
        <button
          onClick={() => navigate('/')}
          className="px-5 py-2 rounded-lg text-sm text-white"
          style={{ background: 'var(--t-green)' }}
        >
          ← Go Home
        </button>
      </div>
    );
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  const SIDEBAR_W = 280;

  return (
    <div className="min-h-[calc(100vh-56px)]" style={{ background: 'var(--t-bg)' }}>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-center gap-3 p-3 lg:p-5">

        {/* ── BOARD COLUMN ─────────────────────────────────────────────── */}
        <div className="flex flex-col items-center gap-2 flex-shrink-0">

          {/* Top player */}
          <PlayerCard name={topName} color={topColor} accuracy={topAcc} counts={topCounts} width={boardSize} />

          {/* Eval bar + board */}
          <div className="flex gap-2 items-stretch">
            <EvalBar evalCp={evalCp} orientation={boardOrientation} height={`${boardSize}px`} />
            <div style={{ width: boardSize, height: boardSize }}>
              <Chessboard
                position={fen}
                boardOrientation={boardOrientation}
                customArrows={arrows}
                customSquareStyles={squareStyles}
                arePiecesDraggable={false}
                animationDuration={150}
                customBoardStyle={{ borderRadius: '6px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
                customDarkSquareStyle={{ backgroundColor: '#769656' }}
                customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
              />
            </div>
          </div>

          {/* Bottom player */}
          <PlayerCard name={btmName} color={btmColor} accuracy={btmAcc} counts={btmCounts} width={boardSize} />

          {/* Navigation row */}
          <div className="flex items-center gap-1.5" style={{ width: boardSize }}>
            <Btn onClick={() => goTo(-1)}              title="Start">⏮</Btn>
            <Btn onClick={() => goTo(currentIndex - 1)} title="Back (←)">◀</Btn>
            <Btn onClick={() => goTo(currentIndex + 1)} title="Next (→)">▶</Btn>
            <Btn onClick={() => goTo(moves.length - 1)} title="End">⏭</Btn>
            <div className="flex-1" />
            <Btn onClick={() => setBoardOrientation(o => o === 'white' ? 'black' : 'white')} title="Flip">⇅</Btn>
            <label className="flex items-center gap-1 text-xs cursor-pointer select-none ml-1"
                   style={{ color: 'var(--t-muted)' }}>
              <input
                type="checkbox" checked={showBestMove}
                onChange={e => setShowBestMove(e.target.checked)}
                className="accent-[var(--t-green)] w-3 h-3"
              />
              Best
            </label>
            {/* Sidebar toggle */}
            <Btn
              onClick={() => setSidebarOpen(o => !o)}
              title={sidebarOpen ? 'Close panel' : 'Open panel'}
            >
              {sidebarOpen ? '▷' : '◁'}
            </Btn>
          </div>

          {/* Eval graph */}
          <div style={{ width: boardSize }}>
            <EvalGraph
              moves={moves}
              initialEval={analysisData.initial_eval ?? 0}
              currentIndex={currentIndex}
              onSelect={goTo}
            />
          </div>
        </div>

        {/* ── SIDEBAR ──────────────────────────────────────────────────── */}
        {sidebarOpen && (
          <div
            className="flex flex-col rounded-lg overflow-hidden border lg:sticky lg:top-[68px] w-full lg:w-[280px] lg:flex-shrink-0"
            style={{
              maxHeight:   'calc(100vh - 76px)',
              background:  'var(--t-surf)',
              borderColor: 'var(--t-border)',
            }}
          >
            {/* Current move banner */}
            {current ? (
              <div
                className="flex items-center gap-2.5 px-3 py-2.5 flex-shrink-0 border-b"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: clsMeta?.color ?? 'var(--t-green)',
                  borderBottomColor: 'var(--t-border)',
                }}
              >
                <span className="text-base font-bold font-mono" style={{ color: 'var(--t-text)' }}>
                  {current.move}{playedPromo ?? ''}
                </span>
                <span className="text-sm font-semibold" style={{ color: clsMeta?.color }}>
                  {clsMeta?.symbol} {current.classification}
                </span>
                {current.cp_loss > 0 && (
                  <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--t-muted)' }}>
                    −{(current.cp_loss / 100).toFixed(2)}
                  </span>
                )}
              </div>
            ) : (
              /* Empty state — no text, just a thin coloured line */
              <div className="h-1 flex-shrink-0" style={{ background: 'var(--t-green)' }} />
            )}

            {/* Best move hint */}
            {current?.best_move && current.best_move !== current.move && (
              <div
                className="flex items-center gap-1.5 px-3 py-1.5 border-b flex-shrink-0"
                style={{ background: 'var(--t-surf2)', borderColor: 'var(--t-border)' }}
              >
                <span className="text-xs" style={{ color: 'var(--t-muted)' }}>Best</span>
                <span className="text-sm font-mono font-bold" style={{ color: 'var(--t-green)' }}>
                  {current.best_move}{bestPromo ?? ''}
                </span>
                {current.alternatives?.length > 0 && (
                  <span className="text-xs ml-1" style={{ color: 'var(--t-muted)' }}>
                    {current.alternatives.map(a => a.move).join(' · ')}
                  </span>
                )}
              </div>
            )}

            {/* Tabs */}
            <div className="flex border-b flex-shrink-0" style={{ borderColor: 'var(--t-border)' }}>
              {[['moves', 'Moves'], ['summary', 'Summary']].map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setSidebarTab(key)}
                  className="flex-1 py-2 text-xs font-semibold uppercase tracking-wider transition-colors"
                  style={{
                    color:       sidebarTab === key ? 'var(--t-text)' : 'var(--t-muted)',
                    borderBottom: sidebarTab === key ? `2px solid var(--t-green)` : '2px solid transparent',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto min-h-0">
              {sidebarTab === 'moves'
                ? <MoveList moves={moves} currentIndex={currentIndex} onSelect={goTo} />
                : <div className="p-3"><GameSummary analysisData={analysisData} /></div>
              }
            </div>

            {/* Close button at bottom */}
            <button
              onClick={() => setSidebarOpen(false)}
              className="flex-shrink-0 w-full py-1.5 text-xs transition-colors border-t"
              style={{
                color: 'var(--t-muted)',
                background: 'var(--t-surf2)',
                borderColor: 'var(--t-border)',
              }}
            >
              Close panel ✕
            </button>
          </div>
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
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={{
          background: color === 'white' ? '#e5e7eb' : '#374151',
          color:      color === 'white' ? '#1f2937' : '#f9fafb',
        }}
      >
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

function Btn({ onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 flex items-center justify-center rounded-lg text-sm transition-colors"
      style={{ background: 'var(--t-surf2)', color: 'var(--t-text2)' }}
      onMouseEnter={e => e.currentTarget.style.background = 'var(--t-surf3)'}
      onMouseLeave={e => e.currentTarget.style.background = 'var(--t-surf2)'}
    >
      {children}
    </button>
  );
}
