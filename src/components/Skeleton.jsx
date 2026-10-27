import React from 'react';

export function Skeleton({ width = '100%', height = '20px', borderRadius = 'var(--radius-md)', className = '' }) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width,
        height,
        borderRadius,
        backgroundColor: 'var(--border-subtle)',
      }}
    />
  );
}
