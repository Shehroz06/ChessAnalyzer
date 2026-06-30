/** Shared chess utility constants and helpers. */

export const CLASSIFICATION_META = {
  Brilliant:  { symbol: '!!', color: '#1bada6', tailwind: 'bg-teal-500',      label: 'Brilliant' },
  Best:       { symbol: '★',  color: '#00a67e', tailwind: 'bg-emerald-600',   label: 'Best' },
  Excellent:  { symbol: '!',  color: '#96bc4b', tailwind: 'bg-lime-500',      label: 'Excellent' },
  Good:       { symbol: '⊕',  color: '#96bc4b', tailwind: 'bg-lime-400',      label: 'Good' },
  Inaccuracy: { symbol: '?!', color: '#f0c15f', tailwind: 'bg-yellow-400',    label: 'Inaccuracy' },
  Mistake:    { symbol: '?',  color: '#e08030', tailwind: 'bg-orange-500',    label: 'Mistake' },
  Blunder:    { symbol: '??', color: '#ca3431', tailwind: 'bg-red-600',       label: 'Blunder' },
};

export const ORDER = ['Brilliant', 'Best', 'Excellent', 'Good', 'Inaccuracy', 'Mistake', 'Blunder'];

/**
 * Parse a UCI move string (e.g. "e2e4") into [from, to] square strings.
 * Returns null if the string is invalid.
 */
export function uciToSquares(uci) {
  if (!uci || uci.length < 4) return null;
  return [uci.slice(0, 2), uci.slice(2, 4)];
}

/**
 * Format a centipawn value for display.
 * Values ≥ 100 000 are treated as mate scores.
 */
export function formatEval(evalCp) {
  if (evalCp === null || evalCp === undefined) return '0.0';
  const abs = Math.abs(evalCp);
  if (abs >= 100_000) {
    const mateIn = abs - 99_000;   // not an exact formula—just display
    return `M${evalCp > 0 ? '' : '-'}${mateIn}`;
  }
  const pawns = (evalCp / 100).toFixed(1);
  return evalCp > 0 ? `+${pawns}` : pawns;
}

/** Clamp centipawns to ±cap and convert to pawns for graph. */
export function clampEval(evalCp, cap = 1000) {
  return Math.max(-cap, Math.min(cap, evalCp)) / 100;
}
