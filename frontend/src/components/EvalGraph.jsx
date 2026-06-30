import { useRef } from 'react';
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip,
} from 'chart.js';
import { Line } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export default function EvalGraph({ moves = [], initialEval = 0, currentIndex = -1, onSelect }) {
  const chartRef = useRef(null);

  const evals  = [initialEval, ...moves.map(m => m.eval)];
  const labels = ['Start', ...moves.map(m =>
    m.player === 'white' ? `${m.move_number}. ${m.move}` : `${m.move_number}… ${m.move}`,
  )];

  function gradient(ctx, chartArea) {
    const { top, bottom } = chartArea;
    const midRatio = Math.max(0, Math.min(1, (1 - (0 + 10) / 20)));
    const midY = top + (bottom - top) * midRatio;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0,                              'rgba(93,185,70,0.35)');
    g.addColorStop((midY - top) / (bottom - top), 'rgba(93,185,70,0.05)');
    g.addColorStop((midY - top) / (bottom - top), 'rgba(0,0,0,0.05)');
    g.addColorStop(1,                              'rgba(0,0,0,0.40)');
    return g;
  }

  const lineColor = cssVar('--c-line') || '#5db946';

  const data = {
    labels,
    datasets: [{
      data: evals,
      borderColor: lineColor,
      borderWidth: 2,
      pointRadius: evals.map((_, i) => i - 1 === currentIndex ? 5 : 0),
      pointBackgroundColor: evals.map((_, i) => i - 1 === currentIndex ? '#facc15' : lineColor),
      pointHoverRadius: 4,
      tension: 0.35,
      fill: true,
      backgroundColor: (ctx) => {
        const chart = ctx.chart;
        if (!chart.chartArea) return 'transparent';
        return gradient(chart.ctx, chart.chartArea);
      },
    }],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    scales: {
      x: { display: false },
      y: {
        min: -10, max: 10,
        grid:  { color: cssVar('--c-grid') || 'rgba(255,255,255,0.06)' },
        ticks: {
          color:    cssVar('--c-tick') || '#6b7280',
          callback: v => v === 0 ? '0' : v > 0 ? `+${v}` : `${v}`,
          stepSize: 5,
        },
        border: { color: cssVar('--t-border') || 'rgba(255,255,255,0.08)' },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: ctx => {
            const v = ctx.parsed.y;
            return v >= 0 ? `White +${v.toFixed(2)}` : `Black +${Math.abs(v).toFixed(2)}`;
          },
        },
        backgroundColor: cssVar('--c-tip')   || '#1e1d1b',
        borderColor:     cssVar('--c-tip-b') || '#555',
        borderWidth: 1,
        titleColor:  cssVar('--c-ttl')  || '#9ca3af',
        bodyColor:   cssVar('--c-body') || '#e2e8f0',
      },
    },
    onClick(_, elements) {
      if (elements.length && onSelect) onSelect(elements[0].index - 1);
    },
    onHover(event, elements) {
      event.native.target.style.cursor = elements.length ? 'pointer' : 'default';
    },
  };

  return (
    <div className="relative w-full h-28 rounded-lg p-2" style={{ background: 'var(--c-bg)' }}>
      <Line ref={chartRef} data={data} options={options} />
    </div>
  );
}
