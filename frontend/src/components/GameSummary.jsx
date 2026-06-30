import { CLASSIFICATION_META, ORDER } from '../utils/chess.js';

function AccuracyRing({ accuracy, color, label }) {
  const r    = 28;
  const circ = 2 * Math.PI * r;
  const fill = (accuracy / 100) * circ;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="72" height="72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="var(--t-surf2)" strokeWidth="6" />
        <circle
          cx="36" cy="36" r={r} fill="none"
          stroke={color} strokeWidth="6"
          strokeDasharray={`${fill} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
          className="transition-all duration-700"
        />
        <text x="36" y="40" textAnchor="middle" fill="var(--t-text)" fontSize="13" fontWeight="bold">
          {accuracy}%
        </text>
      </svg>
      <span className="text-xs truncate max-w-[80px] text-center" style={{ color: 'var(--t-muted)' }}>
        {label}
      </span>
    </div>
  );
}

function CountRow({ label, symbol, color, w, b }) {
  if (!w && !b) return null;
  return (
    <div className="flex items-center gap-2 text-sm py-0.5">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      <span className="flex-1 text-xs" style={{ color: 'var(--t-text2)' }}>{symbol} {label}</span>
      <span className="w-7 text-center font-mono text-xs" style={{ color: 'var(--t-text)' }}>{w}</span>
      <span className="w-7 text-center font-mono text-xs" style={{ color: 'var(--t-muted)' }}>{b}</span>
    </div>
  );
}

export default function GameSummary({ analysisData }) {
  if (!analysisData) return null;
  const {
    accuracy_white, accuracy_black,
    counts_white = {}, counts_black = {},
    opening, eco, headers = {},
  } = analysisData;

  const white  = headers.White  ?? 'White';
  const black  = headers.Black  ?? 'Black';
  const result = headers.Result ?? '*';
  const date   = headers.Date   ?? '';

  return (
    <div className="space-y-4 p-1">
      {/* Result */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--t-muted)' }}>Result</p>
        <p className="text-base font-bold" style={{ color: 'var(--t-text)' }}>
          {white}
          <span className="mx-2" style={{ color: 'var(--t-muted)' }}>{result}</span>
          {black}
        </p>
        {date && <p className="text-xs mt-0.5" style={{ color: 'var(--t-muted)' }}>{date}</p>}
      </div>

      {/* Opening */}
      {opening && opening !== 'Unknown Opening' && (
        <div className="rounded-lg px-3 py-2 text-center" style={{ background: 'var(--t-surf2)' }}>
          <p className="text-xs mb-0.5" style={{ color: 'var(--t-muted)' }}>Opening</p>
          <p className="text-sm font-medium" style={{ color: 'var(--t-text2)' }}>
            {eco && <span className="mr-1" style={{ color: 'var(--t-green)' }}>[{eco}]</span>}
            {opening}
          </p>
        </div>
      )}

      {/* Accuracy rings */}
      <div className="flex justify-around py-2">
        <AccuracyRing accuracy={accuracy_white} color="var(--t-green)" label={white} />
        <AccuracyRing accuracy={accuracy_black} color="#a78bfa"          label={black} />
      </div>

      {/* Move classification counts */}
      <div className="space-y-0.5 pb-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--t-muted)' }}>
          <span className="flex-1" />
          <span className="w-7 text-center">W</span>
          <span className="w-7 text-center">B</span>
        </div>
        {ORDER.map(cls => {
          const meta = CLASSIFICATION_META[cls];
          return (
            <CountRow
              key={cls}
              label={meta?.label ?? cls}
              symbol={meta?.symbol ?? ''}
              color={meta?.color ?? '#888'}
              w={counts_white[cls] ?? 0}
              b={counts_black[cls] ?? 0}
            />
          );
        })}
      </div>
    </div>
  );
}
