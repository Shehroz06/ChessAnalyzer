import { useState, useEffect } from 'react';

export function useBoardSize() {
  const calc = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Height-driven: board should fill ~85% of the area below the navbar
    const maxFromH = Math.floor((vh - 56) * 0.85);

    // Width cap: board shouldn't dominate the whole screen horizontally
    let maxFromW;
    if      (vw >= 1280) maxFromW = Math.floor(vw * 0.55);
    else if (vw >= 1024) maxFromW = Math.floor(vw * 0.58);
    else if (vw >= 768)  maxFromW = Math.floor(vw * 0.65);
    else                 maxFromW = vw - 32;

    return Math.max(260, Math.min(maxFromH, maxFromW));
  };

  const [size, setSize] = useState(calc);

  useEffect(() => {
    const h = () => setSize(calc());
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  return size;
}
