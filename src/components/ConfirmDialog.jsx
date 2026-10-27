import React from 'react';
import { Modal } from './Modal';
import { AlertCircle } from 'lucide-react';

export function ConfirmDialog({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', isDestructive = false }) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="420px">
      <div style={{ display: 'flex', gap: '14px', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div
          style={{
            padding: '10px',
            borderRadius: 'var(--radius-md)',
            backgroundColor: isDestructive ? 'rgba(244, 63, 94, 0.15)' : 'rgba(99, 102, 241, 0.15)',
            color: isDestructive ? 'var(--status-down)' : 'var(--accent-indigo)',
          }}
        >
          <AlertCircle size={22} />
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.5, marginTop: '2px' }}>
          {message}
        </p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
        <button
          type="button"
          onClick={onClose}
          className="btn-secondary"
          style={{ padding: '8px 16px', fontSize: '0.85rem' }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={isDestructive ? 'btn-danger' : 'btn-primary'}
          style={{ padding: '8px 18px', fontSize: '0.85rem' }}
        >
          {confirmText}
        </button>
      </div>
    </Modal>
  );
}
