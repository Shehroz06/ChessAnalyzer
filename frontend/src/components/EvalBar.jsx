/**
 * Vertical evaluation bar using the chess.com Expected Points (win probability) model.
 * White fills from the bottom; the split is driven by win probability, not linear clamping.
 * evalCp: centipawns from White's perspective (+ve = White better).
 */

const _K = 0.00368208;

function _winProb(cp) {
  const c = Math.max(-5000, Math.min(5000, cp));
  return 100 / (1 + Math.exp(-_K * c));
}

export default function EvalBar({ evalCp = 0, orientation = 'white', height = '100%' }) {
  const isMate   = Math.abs(evalCp) >= 99_000;
  const whitePct = isMate ? (evalCp > 0 ? 99.5 : 0.5) : _winProb(evalCp);

  // When board is flipped (black on bottom), white portion goes on top
  const topPct = orientation === 'white' ? 100 - whitePct : whitePct;
  const btmPct = 100 - topPct;

  const abs   = Math.abs(evalCp);
  const label = isMate
    ? `M${evalCp > 0 ? '' : '-'}${abs - 99_000 || 1}`
    : Math.abs(evalCp / 100).toFixed(1);

  return (
    <div className="flex flex-col items-center select-none" style={{ height }}>
      <div className="relative w-5 flex-1 rounded overflow-hidden border border-gray-700">
        {/* Black portion (top) */}
        <div
          className="absolute inset-x-0 top-0 bg-gray-900 transition-all duration-300"
          style={{ height: `${topPct}%` }}
        />
        {/* White portion (bottom) */}
        <div
          className="absolute inset-x-0 bottom-0 bg-gray-100 transition-all duration-300"
          style={{ height: `${btmPct}%` }}
        />
      </div>
      <span className="text-xs text-gray-400 mt-1 font-mono">{label}</span>
    </div>
  );
}
