import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import { devPanel } from '../mock/engine';
import { api } from '../api/client';
import { CONFIG } from '../config';
import { X, Flame, ShieldAlert, Cpu, Database, RefreshCw, Server, AlertOctagon } from 'lucide-react';

export function DevPanel() {
  const { isDevPanelOpen, setIsDevPanelOpen, addToast } = useApp();
  const [monitors, setMonitors] = useState([]);
  const [selectedMonitorId, setSelectedMonitorId] = useState('');

  useEffect(() => {
    if (isDevPanelOpen) {
      api.getMonitors().then((res) => {
        setMonitors(res);
        if (res.length > 0 && !selectedMonitorId) {
          setSelectedMonitorId(res[0].id);
        }
      }).catch(() => {});
    }
  }, [isDevPanelOpen, selectedMonitorId]);

  if (!isDevPanelOpen) return null;

  const handleForceDown = () => {
    if (!selectedMonitorId) return;
    devPanel.forceDown(selectedMonitorId);
    addToast(`Triggered Outage on ${selectedMonitorId}. State moved to SUSPECTED (pulsing amber) -> DOWN (~8s).`, 'warning');
  };

  const handleForceRecover = () => {
    if (!selectedMonitorId) return;
    devPanel.forceRecover(selectedMonitorId);
    addToast(`Restored operational state for ${selectedMonitorId}. Incident resolved.`, 'success');
  };

  const handleLoadTest = () => {
    devPanel.triggerLoadTest();
    addToast('Simulating SQS spike: queueDepth -> 480, workers auto-scaled 3 -> 6.', 'info');
  };

  const handleInstanceSwitch = () => {
    devPanel.switchApiInstance();
    addToast('ALB simulated round-robin to a different EC2 API instance/AZ.', 'info');
  };

  const handleToggleDdb = () => {
    devPanel.toggleDynamoDbFailure();
    addToast('Toggled DynamoDB Streams partition health state.', 'warning');
  };

  const handleReset = () => {
    devPanel.resetAll();
    addToast('Reset mock localStorage to pristine state. Reloading...', 'info');
    setTimeout(() => window.location.reload(), 600);
  };

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '20px',
        width: '360px',
        backgroundColor: 'var(--bg-surface-elevated)',
        border: '1px solid var(--accent-indigo)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-card), 0 12px 36px rgba(0,0,0,0.7)',
        zIndex: 2500,
        overflow: 'hidden',
        animation: 'slideUp 160ms cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Dev Panel Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          backgroundColor: 'rgba(99, 102, 241, 0.15)',
          borderBottom: '1px solid rgba(99, 102, 241, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Flame size={16} color="var(--accent-cyan)" />
          <span style={{ fontSize: '0.82rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
            Chaos & Dev Control
          </span>
          <span
            className="font-mono"
            style={{
              fontSize: '0.65rem',
              padding: '1px 5px',
              backgroundColor: 'var(--bg-surface)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--accent-cyan)',
            }}
          >
            {CONFIG.API_MODE.toUpperCase()}
          </span>
        </div>
        <button
          onClick={() => setIsDevPanelOpen(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '2px',
          }}
        >
          <X size={16} />
        </button>
      </div>

      {/* Dev Panel Content */}
      <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div>
          <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>
            Select Target Monitor:
          </label>
          <select
            value={selectedMonitorId}
            onChange={(e) => setSelectedMonitorId(e.target.value)}
            style={{
              width: '100%',
              padding: '6px 10px',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--text-primary)',
              fontSize: '0.8rem',
            }}
          >
            {monitors.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} [{m.state}]
              </option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <button
            onClick={handleForceDown}
            className="btn-danger"
            style={{ padding: '8px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            <ShieldAlert size={14} />
            Force DOWN
          </button>
          <button
            onClick={handleForceRecover}
            className="btn-secondary"
            style={{ padding: '8px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
          >
            <RefreshCw size={14} />
            Recover UP
          </button>
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <button
            onClick={handleLoadTest}
            className="btn-secondary"
            style={{ width: '100%', padding: '6px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Cpu size={14} color="var(--accent-cyan)" />
            Simulate SQS Load (Auto-Scale 3→6)
          </button>

          <button
            onClick={handleInstanceSwitch}
            className="btn-secondary"
            style={{ width: '100%', padding: '6px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Server size={14} color="var(--accent-indigo)" />
            Simulate ALB Instance Switch
          </button>

          <button
            onClick={handleToggleDdb}
            className="btn-secondary"
            style={{ width: '100%', padding: '6px 10px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <Database size={14} color="var(--status-suspected)" />
            Toggle DynamoDB Degraded Health
          </button>
        </div>

        <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)' }} />

        <button
          onClick={handleReset}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.72rem',
            cursor: 'pointer',
            textAlign: 'center',
            textDecoration: 'underline',
          }}
        >
          Reset All Mock Data to Default Seed
        </button>
      </div>
    </div>
  );
}
