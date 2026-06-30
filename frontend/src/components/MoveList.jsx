import { useEffect, useRef } from 'react';
import { CLASSIFICATION_META } from '../utils/chess.js';

function Badge({ cls }) {
  const meta = CLASSIFICATION_META[cls];
  if (!meta) return null;
  return (
    <span
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold text-white ml-1 flex-shrink-0 ${
        cls === 'Blunder' ? 'badge-blunder' : ''
      }`}
      style={{ backgroundColor: meta.color }}
      title={meta.label}
    >
      {meta.symbol}
    </span>
  );
}

function MoveCell({ move, isActive, onClick }) {
  if (!move) return <span className="flex-1 px-1" />;
  const meta = CLASSIFICATION_META[move.classification] || {};
  return (
    <button
      onClick={onClick}
      className="flex-1 flex items-center px-2 py-1.5 rounded text-sm font-mono text-left transition-colors"
      style={{
        background: isActive ? 'var(--t-green)' : undefined,
        color:      isActive ? '#fff' : (meta.color ?? 'var(--t-text2)'),
      }}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--t-surf2)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = ''; }}
    >
      <span>{move.move}</span>
      <Badge cls={move.classification} />
    </button>
  );
}

export default function MoveList({ moves = [], currentIndex = -1, onSelect }) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [currentIndex]);

  const pairs = [];
  for (let i = 0; i < moves.length; i += 2) {
    pairs.push({ white: moves[i], black: moves[i + 1] ?? null });
  }

  return (
    <div className="overflow-y-auto flex-1 min-h-0 text-sm">
      <table className="w-full">
        <tbody>
          {pairs.map(({ white, black }, pairIdx) => {
            const wi = pairIdx * 2;
            const bi = pairIdx * 2 + 1;
            const anyActive = currentIndex === wi || currentIndex === bi;
            return (
              <tr
                key={pairIdx}
                ref={anyActive ? activeRef : null}
                className="border-b"
                style={{ borderColor: 'var(--t-border)' }}
              >
                <td
                  className="w-8 py-1 pl-3 text-xs font-mono flex-shrink-0"
                  style={{ color: 'var(--t-muted)' }}
                >
                  {white.move_number}.
                </td>
                <td className="py-1 pr-1">
                  <MoveCell move={white} isActive={currentIndex === wi} onClick={() => onSelect(wi)} />
                </td>
                <td className="py-1 pl-1">
                  <MoveCell move={black} isActive={currentIndex === bi} onClick={() => onSelect(bi)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
