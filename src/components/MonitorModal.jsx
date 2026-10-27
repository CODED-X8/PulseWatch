import React, { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Globe, Clock, ShieldAlert, Cpu } from 'lucide-react';

export function MonitorModal({ isOpen, onClose, monitorToEdit = null, onSuccess }) {
  const { addToast } = useApp();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [intervalMin, setIntervalMin] = useState(5);
  const [expectedStatus, setExpectedStatus] = useState(200);
  const [timeoutSec, setTimeoutSec] = useState(10);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (monitorToEdit) {
      setName(monitorToEdit.name || '');
      setUrl(monitorToEdit.url || '');
      setIntervalMin(monitorToEdit.intervalMin || 5);
      setExpectedStatus(monitorToEdit.expectedStatus || 200);
      setTimeoutSec(monitorToEdit.timeoutSec || 10);
    } else {
      setName('');
      setUrl('');
      setIntervalMin(5);
      setExpectedStatus(200);
      setTimeoutSec(10);
    }
    setError('');
  }, [monitorToEdit, isOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      if (monitorToEdit) {
        await api.updateMonitor(monitorToEdit.id, {
          name,
          url,
          intervalMin,
          expectedStatus,
          timeoutSec,
        });
        addToast(`Monitor "${name}" configuration updated.`, 'success');
      } else {
        await api.createMonitor({
          name,
          url,
          intervalMin,
          expectedStatus,
          timeoutSec,
        });
        addToast(`Monitor "${name}" deployed with state PENDING. Initializing ping...`, 'success');
      }
      onSuccess?.();
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to save monitor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={monitorToEdit ? 'Modify Monitor Configuration' : 'Add Production Monitor'}
      maxWidth="520px"
    >
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {error && (
          <div
            style={{
              padding: '10px 14px',
              backgroundColor: 'rgba(244, 63, 94, 0.12)',
              border: '1px solid rgba(244, 63, 94, 0.3)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--status-down)',
              fontSize: '0.8rem',
              display: 'flex',
              gap: '8px',
            }}
          >
            <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{error}</span>
          </div>
        )}

        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Friendly Service Name
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. EU Core Auth API"
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.88rem',
            }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
            Endpoint URL (HTTP or HTTPS)
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type="text"
              required
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://service.domain.com/health"
              maxLength={2048}
              style={{
                width: '100%',
                padding: '8px 12px 8px 34px',
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.88rem',
                fontFamily: 'var(--font-mono)',
              }}
            />
            <Globe size={15} color="var(--text-muted)" style={{ position: 'absolute', left: '11px', top: '10px' }} />
          </div>
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Private CIDR ranges (10.x, 172.x, 192.168.x, 127.x) are blocked by default for SSRF security.
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Interval
            </label>
            <select
              value={intervalMin}
              onChange={(e) => setIntervalMin(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 10px',
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            >
              <option value={1}>1 min</option>
              <option value={5}>5 min (std)</option>
              <option value={15}>15 min</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Expected Code
            </label>
            <input
              type="number"
              value={expectedStatus}
              onChange={(e) => setExpectedStatus(Number(e.target.value))}
              placeholder="200"
              style={{
                width: '100%',
                padding: '8px 10px',
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
                fontFamily: 'var(--font-mono)',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Timeout
            </label>
            <select
              value={timeoutSec}
              onChange={(e) => setTimeoutSec(Number(e.target.value))}
              style={{
                width: '100%',
                padding: '8px 10px',
                backgroundColor: 'var(--bg-surface-elevated)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.85rem',
              }}
            >
              <option value={5}>5 sec</option>
              <option value={10}>10 sec</option>
              <option value={15}>15 sec</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '12px' }}>
          <button type="button" onClick={onClose} className="btn-secondary" disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={isSubmitting}>
            {isSubmitting ? 'Validating...' : monitorToEdit ? 'Save Changes' : 'Deploy Monitor'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
