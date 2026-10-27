import React from 'react';

/**
 * Radial SVG Uptime Progress Ring
 * Displays e.g. 99.98% with an animated SVG circle
 */
export function RadialUptimeRing({ percentage = 99.9, size = 110, strokeWidth = 9 }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const safePercent = Math.min(100, Math.max(0, percentage));
  const offset = circumference - (safePercent / 100) * circumference;

  let strokeColor = 'var(--status-up)';
  if (safePercent < 95) strokeColor = 'var(--status-down)';
  else if (safePercent < 99) strokeColor = 'var(--status-suspected)';

  return (
    <div
      style={{
        position: 'relative',
        width: `${size}px`,
        height: `${size}px`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        {/* Track circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="var(--border-subtle)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Progress circle */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          fill="none"
          style={{
            transition: 'stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)',
            filter: `drop-shadow(0 0 6px ${strokeColor}44)`,
          }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
        }}
      >
        <span
          className="tabular-nums font-mono"
          style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}
        >
          {percentage.toFixed(2)}%
        </span>
        <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: '2px' }}>
          24h Ratio
        </span>
      </div>
    </div>
  );
}
