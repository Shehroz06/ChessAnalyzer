import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { analyzeGameStream } from '../utils/api.js';

const ANALYSIS_DEPTH = 12; // baked-in, not exposed to user

const EXAMPLE_PGN = `[Event "Example"]
[White "Magnus Carlsen"]
[Black "Hikaru Nakamura"]
[Result "1-0"]

1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 1-0`;

export default function Home() {
  const navigate = useNavigate();
  const [tab, setTab]         = useState('url');
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);

  async function handleAnalyze(e) {
    e.preventDefault();
    if (!input.trim()) { toast.error('Please enter a game URL or PGN.'); return; }
    setLoading(true);
    setProgress(null);
    try {
      const payload = tab === 'pgn' ? { pgn: input } : { url: input };
      const data = await analyzeGameStream(
        { ...payload, depth: ANALYSIS_DEPTH },
        (c, t) => setProgress({ current: c, total: t }),
      );
      navigate('/analyze', { state: { analysisData: data } });
    } catch (err) {
      toast.error(err.message || 'Analysis failed.');
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  /* ── loading screen ──────────────────────────────────────────────────── */
  if (loading) {
    const pct = progress ? Math.round((progress.current / progress.total) * 100) : 0;
    return (
      <div
        className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] gap-6 px-4"
        style={{ background: 'var(--t-bg)' }}
      >
        <div className="text-7xl select-none animate-bounce">♟</div>
        <div className="text-center space-y-1">
          <p className="font-semibold text-lg" style={{ color: 'var(--t-text)' }}>
            {progress ? `Analyzing move ${progress.current} of ${progress.total}` : 'Fetching game…'}
          </p>
          <p className="text-sm" style={{ color: 'var(--t-muted)' }}>Powered by Stockfish 18</p>
        </div>
        {progress && (
          <div className="w-72 space-y-1.5">
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--t-surf2)' }}>
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{ width: `${pct}%`, background: 'var(--t-green)' }}
              />
            </div>
            <p className="text-center text-xs" style={{ color: 'var(--t-muted)' }}>{pct}%</p>
          </div>
        )}
      </div>
    );
  }

  /* ── main ────────────────────────────────────────────────────────────── */
  return (
    <div
      className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 py-12"
      style={{ background: 'var(--t-bg)' }}
    >
      {/* Hero */}
      <div className="text-center mb-10">
        <div className="text-7xl mb-4 select-none">♟</div>
        <h1 className="text-4xl font-bold mb-2 tracking-tight" style={{ color: 'var(--t-text)' }}>
          Chess Analyzer
        </h1>
        <p className="text-lg max-w-md" style={{ color: 'var(--t-muted)' }}>
          Analyze any chess game with Stockfish 18 — move classifications,
          accuracy scores, and full evaluation graph.
        </p>
      </div>

      {/* Card */}
      <div
        className="w-full max-w-lg rounded-2xl shadow-2xl p-6 border"
        style={{ background: 'var(--t-surf)', borderColor: 'var(--t-border)' }}
      >
        {/* Tabs */}
        <div className="flex rounded-lg overflow-hidden border mb-5" style={{ borderColor: 'var(--t-border)' }}>
          {[['url', '🔗  Chess.com URL'], ['pgn', '📋  Paste PGN']].map(([key, label]) => (
            <button
              key={key}
              onClick={() => { setTab(key); setInput(''); }}
              className="flex-1 py-2 text-sm font-medium transition-colors"
              style={{
                background: tab === key ? 'var(--t-green)' : 'var(--t-surf2)',
                color:      tab === key ? '#fff'           : 'var(--t-muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={handleAnalyze} className="space-y-4">
          {tab === 'url' ? (
            <div>
              <label className="block text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--t-muted)' }}>
                Chess.com game URL or ID
              </label>
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="https://www.chess.com/game/live/123456789"
                className="w-full rounded-lg px-3 py-2.5 text-sm border focus:outline-none focus:ring-2"
                style={{
                  background:  'var(--t-surf2)',
                  borderColor: 'var(--t-border)',
                  color:       'var(--t-text)',
                  '--tw-ring-color': 'var(--t-green)',
                }}
              />
              <p className="text-xs mt-1.5" style={{ color: 'var(--t-muted)' }}>
                Works with live and daily games. Include ?username= for best results.
              </p>
            </div>
          ) : (
            <div>
              <label className="block text-xs uppercase tracking-wider mb-1.5" style={{ color: 'var(--t-muted)' }}>
                PGN
              </label>
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={EXAMPLE_PGN}
                rows={7}
                className="w-full rounded-lg px-3 py-2.5 text-sm font-mono resize-none border focus:outline-none focus:ring-2"
                style={{
                  background:  'var(--t-surf2)',
                  borderColor: 'var(--t-border)',
                  color:       'var(--t-text)',
                  '--tw-ring-color': 'var(--t-green)',
                }}
              />
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 font-semibold rounded-xl text-sm text-white transition-colors"
            style={{ background: 'var(--t-green)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--t-green-h)'}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--t-green)'}
          >
            Analyze Game
          </button>
        </form>
      </div>

      {/* Play shortcut */}
      <div className="mt-6 text-center">
        <p className="text-sm mb-2" style={{ color: 'var(--t-muted)' }}>or</p>
        <button
          onClick={() => navigate('/play')}
          className="px-6 py-2.5 rounded-xl text-sm font-medium border transition-colors"
          style={{
            background:  'var(--t-surf2)',
            borderColor: 'var(--t-border)',
            color:       'var(--t-text2)',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--t-surf3)'}
          onMouseLeave={e => e.currentTarget.style.background = 'var(--t-surf2)'}
        >
          ♙ Play vs Computer
        </button>
      </div>
    </div>
  );
}
