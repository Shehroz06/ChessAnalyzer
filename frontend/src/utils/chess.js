/** Shared chess utility constants and helpers. */

export const CLASSIFICATION_META = {
  Brilliant:  { symbol: '!!', color: '#1bada6', label: 'Brilliant' },
  Great:      { symbol: '!',  color: '#4b88e3', label: 'Great'     },
  Book:       { symbol: '📖', color: '#c8a066', label: 'Book'      },
  Best:       { symbol: '★',  color: '#00a67e', label: 'Best'      },
  Excellent:  { symbol: '✦',  color: '#96bc4b', label: 'Excellent' },
  Good:       { symbol: '✓',  color: '#7fc37e', label: 'Good'      },
  Inaccuracy: { symbol: '?!', color: '#f0c15f', label: 'Inaccuracy'},
  Mistake:    { symbol: '?',  color: '#e08030', label: 'Mistake'   },
  Miss:       { symbol: '✗',  color: '#c4707a', label: 'Miss'      },
  Blunder:    { symbol: '??', color: '#ca3431', label: 'Blunder'   },
};

export const ORDER = [
  'Brilliant', 'Great', 'Book', 'Best', 'Excellent',
  'Good', 'Inaccuracy', 'Mistake', 'Miss', 'Blunder',
];

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
    const mateIn = abs - 99_000;
    return `M${evalCp > 0 ? '' : '-'}${mateIn}`;
  }
  const pawns = (evalCp / 100).toFixed(1);
  return evalCp > 0 ? `+${pawns}` : pawns;
}

/** Clamp centipawns to ±cap and convert to pawns for graph. */
export function clampEval(evalCp, cap = 1000) {
  return Math.max(-cap, Math.min(cap, evalCp)) / 100;
}
