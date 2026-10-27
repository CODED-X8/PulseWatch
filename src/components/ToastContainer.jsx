import React from 'react';
import { useApp } from '../context/AppContext';
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from 'lucide-react';

export function ToastContainer() {
  const { toasts, removeToast } = useApp();

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        zIndex: 2000,
        maxWidth: '380px',
        width: '100%',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => {
        let Icon = Info;
        let iconColor = 'var(--accent-cyan)';
        let borderColor = 'var(--border-subtle)';

        if (toast.type === 'success') {
          Icon = CheckCircle2;
          iconColor = 'var(--status-up)';
          borderColor = 'rgba(52, 211, 153, 0.3)';
        } else if (toast.type === 'error') {
          Icon = AlertCircle;
          iconColor = 'var(--status-down)';
          borderColor = 'rgba(244, 63, 94, 0.3)';
        } else if (toast.type === 'warning') {
          Icon = AlertTriangle;
          iconColor = 'var(--status-suspected)';
          borderColor = 'rgba(251, 191, 36, 0.3)';
        }

        return (
          <div
            key={toast.id}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '12px 16px',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: `1px solid ${borderColor}`,
              boxShadow: 'var(--shadow-card), 0 8px 24px rgba(0,0,0,0.5)',
              borderRadius: 'var(--radius-md)',
              fontSize: '0.85rem',
              color: 'var(--text-primary)',
              animation: 'slideInRight 180ms ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Icon size={18} color={iconColor} style={{ flexShrink: 0 }} />
              <span>{toast.message}</span>
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
