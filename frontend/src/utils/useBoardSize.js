import { useState, useEffect } from 'react';

/*
 * Board-column fixed overhead (no eval graph in column):
 *   2 × PlayerCard rows : ~88 px
 *   nav button row      : ~44 px
 *   progress bar + gaps : ~30 px
 *   Total               : ~162 px  →  use 175 px for safety
 */
const BOARD_COLUMN_OVERHEAD = 175;

export function useBoardSize() {
  const calc = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Fill as much vertical space as possible
    const maxFromH = Math.max(280, Math.floor(vh - 56 - BOARD_COLUMN_OVERHEAD));

    // Horizontal cap so the board doesn't dominate the full screen width
    let maxFromW;
    if      (vw >= 1280) maxFromW = Math.floor(vw * 0.50);
    else if (vw >= 1024) maxFromW = Math.floor(vw * 0.54);
    else if (vw >= 768)  maxFromW = Math.floor(vw * 0.62);
    else                 maxFromW = vw - 32;

    return Math.max(280, Math.min(maxFromH, maxFromW));
  };

  const [size, setSize] = useState(calc);

  useEffect(() => {
    const h = () => setSize(calc());
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  return size;
}
