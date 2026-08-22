import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import toast from 'react-hot-toast';

import EvalBar from '../components/EvalBar.jsx';
import { playMove, evaluate } from '../utils/api.js';
import { uciToSquares } from '../utils/chess.js';
import { useBoardSize } from '../utils/useBoardSize.js';

async function quickEval(fen, cb) {
  try { const { eval_cp } = await evaluate({ fen, depth: 11 }); cb(eval_cp); }
  catch { /* non-critical */ }
}

const ELO_LEVELS = [
  { label: 'Beginner',     elo: 800  },
  { label: 'Casual',       elo: 1200 },
  { label: 'Intermediate', elo: 1500 },
  { label: 'Advanced',     elo: 1800 },
  { label: 'Expert',       elo: 2200 },
  { label: 'Master',       elo: null },
];

const SIDEBAR_W = 260;

export default function PlayPage() {
  const navigate  = useNavigate();
  const boardSize = useBoardSize();

  const [phase, setPhase]             = useState('setup');
  const [playerColor, setPlayerColor] = useState('white');
  const [eloLevel, setEloLevel]       = useState(2);

  const gameRef = useRef(new Chess());
  const [fen,          setFen]       = useState(gameRef.current.fen());
  const [history,      setHistory]   = useState([]);
  const [evalCp,       setEvalCp]    = useState(0);
  const [thinking,     setThinking]  = useState(false);
  const [result,       setResult]    = useState(null);
  const [lastMove,     setLastMove]  = useState(null);
  const [hintArrow,    setHintArrow] = useState(null);
  const [showHint,     setShowHint]  = useState(false);
  // click-to-move
  const [selectedSq,   setSelectedSq]  = useState(null);
  const [legalSquares, setLegalSquares] = useState({});

  const selectedElo = ELO_LEVELS[eloLevel];

  /* ── helpers ─────────────────────────────────────────────────────────── */

  function syncState() {
    const g = gameRef.current;
    setFen(g.fen());
    setHistory(g.history({ verbose: true }));
  }

  function checkGameOver(g) {
    if (!g.isGameOver()) return false;
    let msg = 'Draw';
    if (g.isCheckmate())               msg = g.turn() === 'w' ? 'Black wins' : 'White wins';
    else if (g.isStalemate())          msg = 'Draw — stalemate';
    else if (g.isThreefoldRepetition()) msg = 'Draw — repetition';
    else if (g.isInsufficientMaterial()) msg = 'Draw — insufficient material';
    setResult(msg);
    setPhase('over');
    return true;
  }

  function clearSelection() {
    setSelectedSq(null);
    setLegalSquares({});
  }

  function selectSquare(square) {
    const g = gameRef.current;
    const moves = g.moves({ square, verbose: true });
    if (moves.length === 0) { clearSelection(); return; }

    const styles = {
      [square]: { backgroundColor: 'rgba(255,215,0,0.45)' },
    };
    moves.forEach(m => {
      const isCapture = !!g.get(m.to);
      styles[m.to] = isCapture
        ? { background: 'radial-gradient(circle, transparent 62%, rgba(0,0,0,0.22) 65%)', borderRadius: '50%' }
        : { background: 'radial-gradient(circle, rgba(0,0,0,0.20) 28%, transparent 30%)' };
    });
    setSelectedSq(square);
    setLegalSquares(styles);
  }

  /* ── execute move (shared by click + drag) ───────────────────────────── */
  function executeMove(from, to) {
    const g = gameRef.current;
    try { g.move({ from, to, promotion: 'q' }); } catch { return false; }
    const mv = g.history({ verbose: true }).slice(-1)[0];
    setLastMove({ from: mv.from, to: mv.to });
    setHintArrow(null); setShowHint(false);
    clearSelection();
    syncState();
    if (!checkGameOver(g)) {
      const fen = g.fen();
      quickEval(fen, setEvalCp);
      setTimeout(() => makeAiMove(fen), 100);
    }
    return true;
  }

  /* ── AI move ─────────────────────────────────────────────────────────── */
  const makeAiMove = useCallback(async (currentFen) => {
    setThinking(true);
    try {
      const resp = await playMove({ fen: currentFen, elo: selectedElo.elo, depth: 15 });
      if (resp.game_over && !resp.move) { setResult(resp.result ?? 'Game Over'); setPhase('over'); return; }
      const g = gameRef.current;
      g.move(resp.move);
      const mv = g.history({ verbose: true }).slice(-1)[0];
      setLastMove({ from: mv.from, to: mv.to });
      syncState();
      setEvalCp(resp.eval_cp ?? 0);
      checkGameOver(g);
    } catch (err) {
      toast.error('Engine error: ' + (err?.response?.data?.detail ?? err.message));
    } finally {
      setThinking(false);
    }
  }, [selectedElo.elo]);

  /* ── click-to-move ───────────────────────────────────────────────────── */
  function onSquareClick(square) {
    if (thinking || phase !== 'playing') return;
    const g       = gameRef.current;
    const myColor = playerColor === 'white' ? 'w' : 'b';
    if (g.turn() !== myColor) return;

    const pieceAt = g.get(square);

    if (selectedSq) {
      if (square === selectedSq) { clearSelection(); return; }
      if (executeMove(selectedSq, square)) return;
      if (pieceAt?.color === myColor) { selectSquare(square); return; }
      clearSelection();
      return;
    }

    if (pieceAt?.color === myColor) selectSquare(square);
  }

  /* ── drag handlers ───────────────────────────────────────────────────── */
  function onPieceDragBegin(piece, sourceSquare) {
    if (thinking || phase !== 'playing') return;
    const g       = gameRef.current;
    const myColor = playerColor === 'white' ? 'w' : 'b';
    if (g.turn() !== myColor) return;
    selectSquare(sourceSquare);
  }

  function onDrop(from, to) {
    if (thinking || phase !== 'playing') return false;
    const g       = gameRef.current;
    const myColor = playerColor === 'white' ? 'w' : 'b';
    if (g.turn() !== myColor) return false;
    return executeMove(from, to);
  }

  function onPieceDragEnd() { clearSelection(); }

  /* ── square styles (merged) ──────────────────────────────────────────── */
  const squareStyles = useMemo(() => {
    const styles = {};
    const g = gameRef.current;
    // in-check king (red)
    if (g.inCheck()) {
      const turn  = g.turn();
      const board = g.board();
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const p = board[r][c];
          if (p?.type === 'k' && p.color === turn) {
            const file = 'abcdefgh'[c];
            const rank = 8 - r;
            styles[`${file}${rank}`] = { backgroundColor: 'rgba(202,52,49,0.55)' };
          }
        }
      }
    }
    // last move (yellow)
    if (lastMove) {
      styles[lastMove.from] = { backgroundColor: 'rgba(255,215,0,0.26)' };
      styles[lastMove.to]   = { backgroundColor: 'rgba(255,215,0,0.40)' };
    }
    // selection + legal dots (highest priority)
    Object.assign(styles, legalSquares);
    return styles;
  }, [fen, lastMove, legalSquares]); // fen dep re-evaluates inCheck on every half-move

  /* ── hint ────────────────────────────────────────────────────────────── */
  async function fetchHint() {
    setShowHint(true);
    try {
      const resp = await playMove({ fen: gameRef.current.fen(), depth: 14 });
      const sq = uciToSquares(resp.move);
      if (sq) setHintArrow(sq);
    } catch { /* ignore */ }
  }

  useEffect(() => {
    const h = e => { if (e.key === 'h' || e.key === 'H') fetchHint(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /* ── start game ──────────────────────────────────────────────────────── */
  function startGame() {
    gameRef.current = new Chess();
    setFen(gameRef.current.fen());
    setHistory([]); setEvalCp(0); setResult(null);
    setLastMove(null); setHintArrow(null); setShowHint(false);
    clearSelection();
    setPhase('playing');
    if (playerColor === 'black') setTimeout(() => makeAiMove(gameRef.current.fen()), 300);
  }

  const arrows    = showHint && hintArrow ? [[hintArrow[0], hintArrow[1], '#00a67e']] : [];
  const compColor = playerColor === 'white' ? 'black' : 'white';

  function goHome() {
    if (phase === 'playing' && !window.confirm('Leave this game? Your progress will be lost.')) return;
    navigate('/');
  }

  /* ── render ──────────────────────────────────────────────────────────── */
  return (
    <div className="min-h-[calc(100vh-56px)]" style={{ background: 'var(--t-bg)' }}>
      <div className="px-4 pt-4 lg:px-6 lg:pt-5">
        <button
          onClick={goHome}
          title="Back to Home"
          className="inline-flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--t-green)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(93,185,70,0.12)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          ← Home
        </button>
      </div>
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-center gap-3 p-3 lg:p-4">

      {/* ── BOARD COLUMN ───────────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-2 flex-shrink-0">

        <PlayerLabel
          name={selectedElo.label}
          isComputer
          color={compColor} thinking={thinking} width={boardSize}
        />

        <div className="flex gap-2 items-stretch">
          <EvalBar evalCp={evalCp} orientation={playerColor} height={`${boardSize}px`} />
          <div style={{ width: boardSize, height: boardSize }} className="relative">
            <Chessboard
              position={fen}
              boardOrientation={playerColor}
              onSquareClick={onSquareClick}
              onPieceDrop={onDrop}
              onPieceDragBegin={onPieceDragBegin}
              onPieceDragEnd={onPieceDragEnd}
              customArrows={arrows}
              customSquareStyles={squareStyles}
              arePiecesDraggable={phase === 'playing' && !thinking}
              animationDuration={150}
              customBoardStyle={{ borderRadius: '6px', boxShadow: '0 4px 24px rgba(0,0,0,0.5)' }}
              customDarkSquareStyle={{ backgroundColor: '#769656' }}
              customLightSquareStyle={{ backgroundColor: '#eeeed2' }}
            />
            {thinking && (
              <div className="absolute inset-0 rounded-md flex items-end justify-center pb-3 pointer-events-none"
                   style={{ background: 'rgba(0,0,0,0.08)' }}>
                <span className="text-xs px-3 py-1 rounded-full text-white animate-pulse"
                      style={{ background: 'rgba(0,0,0,0.65)' }}>
                  Computer is thinking…
                </span>
              </div>
            )}
          </div>
        </div>

        <PlayerLabel name="You" color={playerColor} width={boardSize} />
      </div>

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col rounded-lg overflow-hidden border lg:sticky lg:top-[68px] w-full lg:w-[280px] lg:flex-shrink-0"
        style={{
          maxHeight:   'calc(100vh - 76px)',
          background:  'var(--t-surf)',
          borderColor: 'var(--t-border)',
        }}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--t-border)' }}>
          <p className="text-sm font-bold" style={{ color: 'var(--t-text)' }}>
            {phase === 'setup' ? 'New Game' : phase === 'over' ? 'Game Over' : `Playing · ${selectedElo.label}`}
          </p>
        </div>

        {/* SETUP */}
        {phase === 'setup' && (
          <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">
            <div>
              <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: 'var(--t-muted)' }}>
                Play as
              </label>
              <div className="flex gap-2">
                {['white', 'black'].map(c => (
                  <button
                    key={c}
                    onClick={() => setPlayerColor(c)}
                    className="flex-1 py-2 rounded-lg border text-sm font-medium transition-colors capitalize"
                    style={{
                      background:  playerColor === c ? 'var(--t-green)' : 'var(--t-surf2)',
                      borderColor: playerColor === c ? 'var(--t-green)' : 'var(--t-border)',
                      color:       playerColor === c ? '#fff' : 'var(--t-text2)',
                    }}
                  >
                    {c === 'white' ? '♙ White' : '♟ Black'}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-xs uppercase tracking-wider mb-2 block" style={{ color: 'var(--t-muted)' }}>
                Difficulty — <span style={{ color: 'var(--t-green)' }}>{selectedElo.label}</span>
                {selectedElo.elo && <span style={{ color: 'var(--t-muted)' }}> · ~{selectedElo.elo}</span>}
              </label>
              <input
                type="range" min={0} max={ELO_LEVELS.length - 1} step={1}
                value={eloLevel}
                onChange={e => setEloLevel(Number(e.target.value))}
                className="w-full"
                style={{ accentColor: 'var(--t-green)' }}
              />
              <div className="flex justify-between text-xs mt-1" style={{ color: 'var(--t-muted)' }}>
                <span>Beginner</span><span>Master</span>
              </div>
            </div>

            <button
              onClick={startGame}
              className="w-full py-3 font-semibold rounded-xl text-sm text-white transition-colors mt-1"
              style={{ background: 'var(--t-green)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--t-green-h)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--t-green)'}
            >
              Start Game
            </button>

            <div className="text-xs space-y-1 border-t pt-3 mt-auto"
                 style={{ color: 'var(--t-muted)', borderColor: 'var(--t-border)' }}>
              <p>• Click a piece then click a square to move</p>
              <p>• Or drag pieces directly</p>
              <p>• Press <kbd className="px-1 rounded text-xs" style={{ background: 'var(--t-surf2)' }}>H</kbd> for a hint</p>
            </div>
          </div>
        )}

        {/* GAME OVER */}
        {phase === 'over' && (
          <div className="p-4 flex flex-col gap-3 flex-1">
            <div className="rounded-xl p-4 text-center" style={{ background: 'var(--t-surf2)' }}>
              <p className="text-lg font-bold" style={{ color: 'var(--t-text)' }}>{result}</p>
            </div>
            <button
              onClick={() => navigate('/analyze', { state: { pgn: gameRef.current.pgn(), depth: 11 } })}
              className="w-full py-2.5 text-sm font-medium rounded-lg text-white transition-colors"
              style={{ background: 'var(--t-green)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--t-green-h)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--t-green)'}
            >
              Review with Analysis
            </button>
            <button
              onClick={() => setPhase('setup')}
              className="w-full py-2.5 text-sm font-medium rounded-lg transition-colors"
              style={{ background: 'var(--t-surf2)', color: 'var(--t-text2)' }}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--t-surf3)'}
              onMouseLeave={e => e.currentTarget.style.background = 'var(--t-surf2)'}
            >
              New Game
            </button>
          </div>
        )}

        {/* PLAYING */}
        {phase === 'playing' && (
          <div className="flex flex-col flex-1 overflow-hidden">
            <div className="flex gap-2 p-3 border-b flex-shrink-0" style={{ borderColor: 'var(--t-border)' }}>
              <SideBtn
                onClick={() => showHint ? (setHintArrow(null), setShowHint(false)) : fetchHint()}
                extraStyle={showHint ? { color: 'var(--t-green)', borderColor: 'var(--t-green)', background: 'rgba(93,185,70,0.10)' } : {}}
              >
                💡 Hint
              </SideBtn>
              <SideBtn
                onClick={() => setPhase('setup')}
                extraStyle={{ color: '#ca3431', borderColor: 'rgba(202,52,49,0.35)', background: 'rgba(202,52,49,0.08)' }}
              >
                Resign
              </SideBtn>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {history.length === 0 ? (
                <p className="text-xs text-center py-6" style={{ color: 'var(--t-muted)' }}>
                  Make the first move
                </p>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => {
                      const w = history[i * 2];
                      const b = history[i * 2 + 1];
                      const isLatestW = i * 2 === history.length - 1;
                      const isLatestB = i * 2 + 1 === history.length - 1;
                      return (
                        <tr key={i} className="border-b" style={{ borderColor: 'var(--t-border)' }}>
                          <td className="py-1.5 pl-3 text-xs font-mono w-7" style={{ color: 'var(--t-muted)' }}>
                            {i + 1}.
                          </td>
                          <td className="py-1.5 font-mono pr-1"
                              style={{ color: isLatestW ? 'var(--t-green)' : 'var(--t-text)', fontWeight: isLatestW ? 700 : 400 }}>
                            {w?.san}
                          </td>
                          <td className="py-1.5 font-mono"
                              style={{ color: isLatestB ? 'var(--t-green)' : 'var(--t-text2)', fontWeight: isLatestB ? 700 : 400 }}>
                            {b?.san ?? ''}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}
      </div>

      </div>
    </div>
  );
}

/* ── sub-components ──────────────────────────────────────────────────────── */

/* avatar colour per difficulty level */
const ELO_AVATAR_COLOR = {
  Beginner:     { bg: '#22c55e', fg: '#fff' },
  Casual:       { bg: '#84cc16', fg: '#fff' },
  Intermediate: { bg: '#eab308', fg: '#fff' },
  Advanced:     { bg: '#f97316', fg: '#fff' },
  Expert:       { bg: '#ef4444', fg: '#fff' },
  Master:       { bg: '#8b5cf6', fg: '#fff' },
};

function PlayerLabel({ name, color, thinking = false, width, isComputer = false }) {
  const initial = (name ?? '?')[0].toUpperCase();
  const avatarStyle = isComputer
    ? { background: ELO_AVATAR_COLOR[name]?.bg ?? '#6b7280', color: ELO_AVATAR_COLOR[name]?.fg ?? '#fff' }
    : { background: color === 'white' ? '#e5e7eb' : '#374151', color: color === 'white' ? '#1f2937' : '#f9fafb' };

  return (
    <div className="flex items-center gap-2.5 px-1" style={{ width }}>
      <div
        className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
        style={avatarStyle}
      >
        {isComputer ? '♟' : initial}
      </div>
      <span className="text-sm font-semibold flex-1 truncate" style={{ color: 'var(--t-text)' }}>{name}</span>
      {thinking && (
        <span className="text-xs animate-pulse flex-shrink-0" style={{ color: 'var(--t-green)' }}>thinking…</span>
      )}
    </div>
  );
}

function SideBtn({ onClick, children, extraStyle = {} }) {
  const base = {
    background:  extraStyle.background  ?? 'var(--t-surf2)',
    borderColor: extraStyle.borderColor ?? 'var(--t-border)',
    color:       extraStyle.color       ?? 'var(--t-text2)',
  };
  return (
    <button
      onClick={onClick}
      className="flex-1 py-1.5 text-xs rounded-lg border transition-colors"
      style={base}
      onMouseEnter={e => {
        if (!extraStyle.background) e.currentTarget.style.background = 'var(--t-surf3)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = base.background;
      }}
    >
      {children}
    </button>
  );
}
