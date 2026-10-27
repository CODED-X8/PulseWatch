import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, PauseCircle, Clock } from 'lucide-react';

/**
 * Status Badge with Icon + Color Glow + Label
 * UP | SUSPECTED | DOWN | PAUSED | PENDING
 */
export function StatusBadge({ state = 'PENDING', size = 'md' }) {
  const normalized = (state || 'PENDING').toUpperCase();

  const config = {
    UP: {
      label: 'Operational',
      icon: CheckCircle2,
      color: 'var(--status-up)',
      bg: 'rgba(52, 211, 153, 0.1)',
      border: 'rgba(52, 211, 153, 0.25)',
      glow: '0 0 10px rgba(52, 211, 153, 0.3)',
      pulse: false,
    },
    SUSPECTED: {
      label: 'Suspected Blip',
      icon: AlertTriangle,
      color: 'var(--status-suspected)',
      bg: 'rgba(251, 191, 36, 0.12)',
      border: 'rgba(251, 191, 36, 0.35)',
      glow: '0 0 12px rgba(251, 191, 36, 0.4)',
      pulse: true,
    },
    DOWN: {
      label: 'Major Outage',
      icon: XCircle,
      color: 'var(--status-down)',
      bg: 'rgba(244, 63, 94, 0.12)',
      border: 'rgba(244, 63, 94, 0.35)',
      glow: '0 0 12px rgba(244, 63, 94, 0.4)',
      pulse: false,
    },
    PAUSED: {
      label: 'Monitoring Paused',
      icon: PauseCircle,
      color: 'var(--status-paused)',
      bg: 'rgba(107, 114, 128, 0.1)',
      border: 'rgba(107, 114, 128, 0.25)',
      glow: 'none',
      pulse: false,
    },
    PENDING: {
      label: 'Verifying Ingress',
      icon: Clock,
      color: 'var(--status-pending)',
      bg: 'rgba(148, 163, 184, 0.1)',
      border: 'rgba(148, 163, 184, 0.25)',
      glow: 'none',
      pulse: true,
    },
  }[normalized] || {
    label: normalized,
    icon: Clock,
    color: 'var(--status-pending)',
    bg: 'rgba(148, 163, 184, 0.1)',
    border: 'rgba(148, 163, 184, 0.2)',
    glow: 'none',
    pulse: false,
  };

  const Icon = config.icon;
  const isSm = size === 'sm';

  return (
    <span
      className={`status-badge ${config.pulse ? 'pulse-anim' : ''}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: isSm ? '4px' : '6px',
        padding: isSm ? '2px 8px' : '4px 10px',
        borderRadius: 'var(--radius-full)',
        backgroundColor: config.bg,
        border: `1px solid ${config.border}`,
        boxShadow: config.glow,
        color: config.color,
        fontSize: isSm ? '0.72rem' : '0.8rem',
        fontWeight: 600,
        letterSpacing: '0.02em',
        lineHeight: 1,
        transition: 'all var(--transition-fast)',
      }}
    >
      <Icon size={isSm ? 12 : 14} strokeWidth={2.4} />
      <span>{config.label}</span>
    </span>
  );
}
