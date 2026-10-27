import React, { useState, useMemo } from 'react';

/**
 * Custom Pure SVG Latency Area Chart with Interactive Hover Crosshair
 * Zero chart libraries, lightweight, perfectly styled for Linear/Vercel dark UI.
 */
export function LatencyAreaChart({ data = [], height = 240 }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  // Normalize points
  const points = useMemo(() => {
    if (!data || data.length === 0) return [];
    return data.map(item => ({
      ts: new Date(item.ts).getTime(),
      dateStr: new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      latency: item.latencyMs || 0,
      status: item.status || 'UP',
      httpCode: item.httpCode || 200,
    }));
  }, [data]);

  if (points.length < 2) {
    return (
      <div
        style={{
          height: `${height}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
          backgroundColor: 'var(--bg-surface)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        Collecting telemetry telemetry data points...
      </div>
    );
  }

  const latencies = points.map(p => p.latency);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies, 20); // At least 20ms baseline
  const paddingY = 24;
  const paddingX = 40;
  const chartHeight = height - paddingY * 2;
  const widthPercent = 1000; // Virtual width for SVG viewBox coordinate system

  // Scale functions
  const getX = (idx) => paddingX + (idx / (points.length - 1)) * (widthPercent - paddingX * 2);
  const getY = (val) => height - paddingY - ((val - minLatency) / (maxLatency - minLatency || 1)) * chartHeight;

  // Build SVG Path
  const linePath = points.reduce((acc, p, idx) => {
    const x = getX(idx);
    const y = getY(p.latency);
    return idx === 0 ? `M ${x} ${y}` : `${acc} L ${x} ${y}`;
  }, '');

  const areaPath = `${linePath} L ${getX(points.length - 1)} ${height - paddingY} L ${getX(0)} ${height - paddingY} Z`;

  const hoveredPoint = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div style={{ position: 'relative', width: '100%', userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${widthPercent} ${height}`}
        style={{ width: '100%', height: `${height}px`, display: 'block', overflow: 'visible' }}
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="latencyGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent-indigo)" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((ratio, i) => {
          const val = Math.round(minLatency + ratio * (maxLatency - minLatency));
          const y = height - paddingY - ratio * chartHeight;
          return (
            <g key={i}>
              <line
                x1={paddingX}
                y1={y}
                x2={widthPercent - paddingX}
                y2={y}
                stroke="var(--border-subtle)"
                strokeDasharray="4 4"
                strokeWidth="1"
              />
              <text
                x={paddingX - 8}
                y={y + 3}
                fill="var(--text-muted)"
                fontSize="10"
                fontFamily="var(--font-mono)"
                textAnchor="end"
              >
                {val}ms
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#latencyGradient)" />

        {/* Stroke line */}
        <path
          d={linePath}
          fill="none"
          stroke="var(--accent-cyan)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hover Crosshair & Detection Zones */}
        {points.map((p, idx) => {
          const x = getX(idx);
          const y = getY(p.latency);
          const isCurrent = hoverIndex === idx;

          return (
            <g key={idx}>
              {/* Invisible wide capture rect */}
              <rect
                x={x - (widthPercent / points.length) / 2}
                y={0}
                width={widthPercent / points.length}
                height={height}
                fill="transparent"
                style={{ cursor: 'crosshair' }}
                onMouseEnter={() => setHoverIndex(idx)}
              />

              {isCurrent && (
                <g>
                  {/* Vertical line */}
                  <line
                    x1={x}
                    y1={paddingY}
                    x2={x}
                    y2={height - paddingY}
                    stroke="rgba(255, 255, 255, 0.3)"
                    strokeWidth="1"
                    strokeDasharray="2 2"
                  />
                  {/* Outer glow ring */}
                  <circle cx={x} cy={y} r="6" fill="var(--accent-cyan)" fillOpacity="0.3" />
                  {/* Dot */}
                  <circle cx={x} cy={y} r="3.5" fill="var(--text-primary)" stroke="var(--accent-indigo)" strokeWidth="2" />
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Floating Tooltip Card */}
      {hoveredPoint && (
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '12px',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--border-highlight)',
            boxShadow: 'var(--shadow-card)',
            borderRadius: 'var(--radius-md)',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            fontSize: '0.8rem',
            zIndex: 10,
            pointerEvents: 'none',
          }}
        >
          <div>
            <div className="font-mono text-muted" style={{ fontSize: '0.72rem' }}>
              {hoveredPoint.dateStr}
            </div>
            <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
              Response: <span className="tabular-nums font-mono" style={{ color: 'var(--accent-cyan)' }}>{hoveredPoint.latency}ms</span>
            </div>
          </div>
          <div
            style={{
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.72rem',
              fontWeight: 600,
              backgroundColor: hoveredPoint.status === 'UP' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(244, 63, 94, 0.15)',
              color: hoveredPoint.status === 'UP' ? 'var(--status-up)' : 'var(--status-down)',
            }}
          >
            HTTP {hoveredPoint.httpCode}
          </div>
        </div>
      )}
    </div>
  );
}
