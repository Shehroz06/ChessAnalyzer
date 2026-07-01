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

export default function EvalGraph({ moves = [], initialWinProb = 0.5, currentIndex = -1, onSelect }) {
  const chartRef = useRef(null);

  // win_prob is 0-1 (White's win probability); 0.5 = equal
  const winProbs = [initialWinProb, ...moves.map(m => m.win_prob ?? 0.5)];
  const labels   = ['Start', ...moves.map(m =>
    m.player === 'white' ? `${m.move_number}. ${m.move}` : `${m.move_number}… ${m.move}`,
  )];

  function gradient(ctx, chartArea) {
    const { top, bottom } = chartArea;
    // win_prob 0.5 (equal) sits at the vertical midpoint of the chart
    const midY = top + (bottom - top) * 0.5;
    const stop = (midY - top) / (bottom - top);
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0,    'rgba(93,185,70,0.35)');
    g.addColorStop(stop, 'rgba(93,185,70,0.05)');
    g.addColorStop(stop, 'rgba(0,0,0,0.05)');
    g.addColorStop(1,    'rgba(0,0,0,0.40)');
    return g;
  }

  const lineColor = cssVar('--c-line') || '#5db946';

  const data = {
    labels,
    datasets: [{
      data: winProbs,
      borderColor: lineColor,
      borderWidth: 2,
      pointRadius: winProbs.map((_, i) => i - 1 === currentIndex ? 5 : 0),
      pointBackgroundColor: winProbs.map((_, i) => i - 1 === currentIndex ? '#facc15' : lineColor),
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
        min: 0,
        max: 1,
        grid:  { color: cssVar('--c-grid') || 'rgba(255,255,255,0.06)' },
        ticks: {
          color:    cssVar('--c-tick') || '#6b7280',
          callback: v => `${Math.round(v * 100)}%`,
          stepSize: 0.25,
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
            const wpct = Math.round(v * 100);
            const bpct = 100 - wpct;
            return wpct >= 50
              ? `White: ${wpct}%  ·  Black: ${bpct}%`
              : `Black: ${bpct}%  ·  White: ${wpct}%`;
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
