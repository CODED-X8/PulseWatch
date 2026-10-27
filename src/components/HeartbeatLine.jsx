import React from 'react';

/**
 * Signature ECG Heartbeat Waveform Component
 * Styles:
 *  - 'steady' (emerald UP)
 *  - 'irregular' (amber pulsing SUSPECTED)
 *  - 'flat' (crimson DOWN)
 *  - 'paused' (slate muted)
 */
export function HeartbeatLine({ status = 'steady', width = 90, height = 24, className = '' }) {
  let strokeColor = 'var(--status-up)';
  let glowColor = 'var(--status-up-glow)';
  let pathD = 'M0,12 L20,12 L24,4 L28,20 L32,8 L36,16 L40,12 L90,12';
  let animClass = 'ecg-steady';

  if (status === 'irregular' || status === 'SUSPECTED') {
    strokeColor = 'var(--status-suspected)';
    glowColor = 'var(--status-suspected-glow)';
    pathD = 'M0,12 L15,12 L20,3 L26,22 L31,6 L35,18 L40,12 L55,12 L60,4 L65,20 L70,12 L90,12';
    animClass = 'ecg-irregular';
  } else if (status === 'flat' || status === 'DOWN') {
    strokeColor = 'var(--status-down)';
    glowColor = 'var(--status-down-glow)';
    pathD = 'M0,12 L90,12';
    animClass = 'ecg-flat';
  } else if (status === 'PAUSED' || status === 'paused') {
    strokeColor = 'var(--status-paused)';
    glowColor = 'transparent';
    pathD = 'M0,12 L90,12';
    animClass = 'ecg-paused';
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 90 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`heartbeat-svg ${animClass} ${className}`}
      style={{
        filter: glowColor !== 'transparent' ? `drop-shadow(0 0 4px ${glowColor})` : 'none',
        overflow: 'visible',
      }}
    >
      <path
        d={pathD}
        stroke={strokeColor}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={status === 'PAUSED' ? '3 3' : 'none'}
      />
    </svg>
  );
}
