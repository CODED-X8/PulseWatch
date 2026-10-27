import React, { useState, useEffect } from 'react';
import { Activity, ShieldCheck, Zap } from 'lucide-react';

const TICKER_EVENTS = [
  { icon: ShieldCheck, text: 'ap-south-1a Edge Ingress is operating within nominal latency thresholds (<45ms).' },
  { icon: Activity, text: 'Automated TLS Certificate validity verified for all monitored domains.' },
  { icon: Zap, text: 'Worker Auto Scaling Group fleet health: 100% capacity in 3 AZs.' },
  { icon: ShieldCheck, text: 'DynamoDB Streams TTL check worker cycle executed with zero DLQ dead-letters.' },
];

export function EventTicker() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % TICKER_EVENTS.length);
    }, 6000);
    return () => clearInterval(timer);
  }, []);

  const current = TICKER_EVENTS[index];
  const Icon = current.icon;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '6px 14px',
        backgroundColor: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-full)',
        fontSize: '0.76rem',
        color: 'var(--text-secondary)',
        overflow: 'hidden',
        maxWidth: '600px',
      }}
    >
      <Icon size={13} color="var(--accent-cyan)" style={{ flexShrink: 0 }} />
      <span
        key={index}
        style={{
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          overflow: 'hidden',
          animation: 'fadeIn 300ms ease-out',
        }}
      >
        {current.text}
      </span>
    </div>
  );
}
