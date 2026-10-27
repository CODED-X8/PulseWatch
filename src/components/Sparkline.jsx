import React from 'react';

/**
 * Pure SVG Mini Sparkline
 * Used inside stat cards to visualize immediate metric trend without chart bloat
 */
export function Sparkline({ data = [40, 42, 38, 45, 48, 44, 46], width = 84, height = 28, color = 'var(--accent-cyan)' }) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((val, idx) => {
      const x = (idx / (data.length - 1)) * (width - 4) + 2;
      const y = height - 3 - ((val - min) / range) * (height - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" style={{ overflow: 'visible' }}>
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
      {/* Trailing indicator dot */}
      {data.length > 0 && (
        <circle
          cx={width - 2}
          cy={height - 3 - ((data[data.length - 1] - min) / range) * (height - 8)}
          r="2.5"
          fill={color}
        />
      )}
    </svg>
  );
}
