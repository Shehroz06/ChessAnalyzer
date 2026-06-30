/**
 * Vertical evaluation bar.
 * White fills from the bottom, black from the top.
 * evalCp: centipawns from white's perspective (+ve = white better).
 */
export default function EvalBar({ evalCp = 0, orientation = 'white', height = '100%' }) {
  const clamped = Math.max(-1000, Math.min(1000, evalCp));
  // percentage of the bar that is WHITE
  const whitePct = ((clamped + 1000) / 2000) * 100;

  // When the board is flipped (black on bottom), white pct goes on top
  const topPct   = orientation === 'white' ? 100 - whitePct : whitePct;
  const btmPct   = 100 - topPct;

  const isMate = Math.abs(evalCp) >= 99_000;
  const abs    = Math.abs(evalCp);
  const label  = isMate
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
