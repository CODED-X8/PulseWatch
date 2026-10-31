import React, { useState } from 'react';

/**
 * 90-Segment Interactive Uptime Strip
 * Segment types: 'up' (emerald), 'down' (crimson), 'none' (slate)
 * Hover shows tooltip with check index and status
 */
export function UptimeStrip({ strip = [], height = 28, showLabels = true }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  // Guarantee 90 items padded with 'none' for days without telemetry
  const normalized = [...strip];
  while (normalized.length < 90) {
    normalized.unshift('none');
  }
  const displayStrip = normalized.slice(-90);

  // Calculate uptime percentage ONLY using days with actual data
  const dataDays = displayStrip.filter((s) => s === 'up' || s === 'down');
  const upDays = dataDays.filter((s) => s === 'up').length;
  const uptimePercent =
    dataDays.length > 0 ? (upDays / dataDays.length) * 100 : 100;
  const formattedUptime =
    uptimePercent === 100
      ? '100% Uptime'
      : `${uptimePercent.toFixed(1)}% Uptime`;

  return (
    <div className="uptime-strip-container" style={{ position: 'relative', width: '100%' }}>
      <div
        className="uptime-strip-bars"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '2px',
          height: `${height}px`,
          width: '100%',
        }}
      >
        {displayStrip.map((status, idx) => {
          let bg = 'var(--status-up)';
          let label = '100% Operational';
          if (status === 'down') {
            bg = 'var(--status-down)';
            label = 'Degraded / Unreachable';
          } else if (status === 'none') {
            bg = '#4b5563'; // Neutral grey for days with no data
            label = 'No telemetry recorded';
          }

          const isHovered = hoverIndex === idx;

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoverIndex(idx)}
              onMouseLeave={() => setHoverIndex(null)}
              style={{
                flex: 1,
                height: '100%',
                backgroundColor: bg,
                borderRadius: '2px',
                opacity: isHovered ? 1 : status === 'none' ? 0.45 : 0.85,
                transform: isHovered ? 'scaleY(1.15)' : 'scaleY(1)',
                transition: 'all 120ms ease-out',
                cursor: 'pointer',
              }}
            />
          );
        })}
      </div>

      {/* Floating Tooltip */}
      {hoverIndex !== null && (
        <div
          style={{
            position: 'absolute',
            bottom: `${height + 8}px`,
            left: `${(hoverIndex / 90) * 100}%`,
            transform: 'translateX(-50%)',
            background: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-highlight)',
            boxShadow: 'var(--shadow-card)',
            padding: '4px 8px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.72rem',
            whiteSpace: 'nowrap',
            zIndex: 30,
            pointerEvents: 'none',
          }}
        >
          <span className="font-mono text-muted">{90 - hoverIndex}d ago: </span>
          <span
            style={{
              color:
                displayStrip[hoverIndex] === 'down'
                  ? 'var(--status-down)'
                  : displayStrip[hoverIndex] === 'none'
                  ? '#9ca3af'
                  : 'var(--status-up)',
              fontWeight: 600,
            }}
          >
            {displayStrip[hoverIndex] === 'down'
              ? 'Downtime Incident'
              : displayStrip[hoverIndex] === 'none'
              ? 'No Data'
              : 'Operational (100%)'}
          </span>
        </div>
      )}

      {showLabels && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: '6px',
            fontSize: '0.72rem',
            color: 'var(--text-muted)',
          }}
        >
          <span>90 days ago</span>
          <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>
            {formattedUptime}
          </span>
          <span>Today</span>
        </div>
      )}
    </div>
  );
}
