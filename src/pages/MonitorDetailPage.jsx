import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { HeartbeatLine } from '../components/HeartbeatLine';
import { StatusBadge } from '../components/StatusBadge';
import { UptimeStrip } from '../components/UptimeStrip';
import { RadialUptimeRing } from '../components/RadialUptimeRing';
import { LatencyAreaChart } from '../components/LatencyAreaChart';
import { MonitorModal } from '../components/MonitorModal';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Skeleton } from '../components/Skeleton';
import {
  ArrowLeft,
  Pause,
  Play,
  Edit2,
  Trash2,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';

export function MonitorDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { addToast } = useApp();

  const [monitor, setMonitor] = useState(null);
  const [history, setHistory] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [timeRange, setTimeRange] = useState('24h');

  // Modals & Dialogs
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const allMonitors = await api.getMonitors();
      const target = allMonitors.find((m) => m.id === id);
      if (!target) {
        addToast('Monitor not found.', 'error');
        navigate('/dashboard');
        return;
      }
      setMonitor(target);

      try {
        const histData = await api.getMonitorHistory(id, timeRange);
        setHistory(histData);
        setHistoryFailed(false);
      } catch (err) {
        console.warn('History telemetry fetch failed:', err);
        setHistoryFailed(true);
      }

      try {
        const incData = await api.getIncidents();
        setIncidents(incData.filter((i) => i.monitorId === id));
      } catch (err) {
        console.warn('Incidents fetch failed:', err);
      }
    } catch (err) {
      addToast(err.message || 'Error loading monitor.', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, timeRange, navigate, addToast]);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      loadData();
    }, 6000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handlePauseResume = async () => {
    if (!monitor) return;
    try {
      if (monitor.state === 'PAUSED') {
        const updated = await api.resumeMonitor(monitor.id);
        setMonitor(updated);
        addToast(`Resumed monitoring for ${monitor.name}.`, 'success');
      } else {
        const updated = await api.pauseMonitor(monitor.id);
        setMonitor(updated);
        addToast(`Paused monitoring for ${monitor.name}.`, 'info');
      }
    } catch (err) {
      addToast(err.message || 'Action failed.', 'error');
    }
  };

  const handleDelete = async () => {
    if (!monitor) return;
    try {
      await api.deleteMonitor(monitor.id);
      addToast(`Monitor ${monitor.name} deleted.`, 'success');
      navigate('/dashboard');
    } catch (err) {
      addToast(err.message || 'Delete failed.', 'error');
    }
  };

  if (loading && !monitor) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <Skeleton width="40%" height="36px" />
        <Skeleton width="100%" height="240px" />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Navigation Row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <button
          onClick={() => navigate('/dashboard')}
          className="btn-secondary"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '6px 12px', fontSize: '0.8rem' }}
        >
          <ArrowLeft size={14} />
          <span>Back to Monitors</span>
        </button>

        {/* Action Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={handlePauseResume}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '0.8rem' }}
          >
            {monitor.state === 'PAUSED' ? <Play size={14} color="var(--status-up)" /> : <Pause size={14} />}
            <span>{monitor.state === 'PAUSED' ? 'Resume' : 'Pause'}</span>
          </button>
          <button
            onClick={() => setIsEditModalOpen(true)}
            className="btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '0.8rem' }}
          >
            <Edit2 size={14} />
            <span>Edit</span>
          </button>
          <button
            onClick={() => setIsDeleteDialogOpen(true)}
            className="btn-danger"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 12px', fontSize: '0.8rem' }}
          >
            <Trash2 size={14} />
            <span>Delete</span>
          </button>
        </div>
      </div>

      {/* Header Info Card */}
      <div
        className="card-surface"
        style={{
          padding: '24px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>{monitor.name}</h1>
            <StatusBadge state={monitor.state} />
          </div>

          <a
            href={monitor.url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-muted"
            style={{
              fontSize: '0.82rem',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              textDecoration: 'none',
              maxWidth: '500px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            <span>{monitor.url}</span>
            <ExternalLink size={12} />
          </a>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
            <span>Check interval: <strong className="font-mono">{monitor.intervalMin}m</strong></span>
            <span>Expected HTTP: <strong className="font-mono">{monitor.expectedStatus}</strong></span>
            <span>Timeout: <strong className="font-mono">{monitor.timeoutSec}s</strong></span>
          </div>
        </div>

        {/* Heartbeat & Radial Ring */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
            <HeartbeatLine status={monitor.state} width={110} height={28} />
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              {monitor.state === 'DOWN' ? 'Outage Confirmed' : monitor.state === 'SUSPECTED' ? 'Analyzing Blip' : 'Heartbeat Nominal'}
            </span>
          </div>
          <RadialUptimeRing percentage={monitor.uptime24h || 99.9} size={100} />
        </div>
      </div>

      {/* Latency Chart Section */}
      <div className="card-surface" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>Response Latency Telemetry</h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Round-trip synthetic HTTP latency captured from worker fleet
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-surface-elevated)',
              padding: '2px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            {['1h', '24h', '7d'].map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontWeight: timeRange === r ? 600 : 400,
                  backgroundColor: timeRange === r ? 'var(--bg-surface)' : 'transparent',
                  color: timeRange === r ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {r.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {historyFailed ? (
          <div
            style={{
              padding: '36px',
              textAlign: 'center',
              backgroundColor: 'var(--bg-surface-elevated)',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <AlertTriangle size={24} color="var(--status-suspected)" style={{ margin: '0 auto 8px auto' }} />
            <h4 style={{ fontSize: '0.9rem', color: 'var(--text-primary)' }}>History unavailable</h4>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              Historical timeseries partition timed out. Live telemetry & status remain operational.
            </p>
          </div>
        ) : (
          <LatencyAreaChart data={history} height={230} />
        )}
      </div>

      {/* 90-Bar Uptime Strip */}
      <div className="card-surface" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          90-Day Telemetry History
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
          Daily reliability breakdown. Hover over individual days to inspect outage events.
        </p>
        <UptimeStrip strip={monitor.strip} height={32} showLabels={true} />
      </div>

      {/* Two Column Grid: Recent Checks & Active/Past Incidents */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '20px' }}>
        {/* Recent Checks Table */}
        <div className="card-surface" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '14px' }}>
            Recent Synthetic Probes
          </h3>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '8px 10px' }}>Time</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                  <th style={{ padding: '8px 10px' }}>Code</th>
                  <th style={{ padding: '8px 10px' }}>Latency</th>
                  <th style={{ padding: '8px 10px' }}>Error Details</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(-8).reverse().map((chk, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="font-mono text-muted" style={{ padding: '10px 10px' }}>
                      {new Date(chk.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td style={{ padding: '10px 10px' }}>
                      <span
                        style={{
                          color: chk.status === 'UP' ? 'var(--status-up)' : 'var(--status-down)',
                          fontWeight: 600,
                        }}
                      >
                        {chk.status}
                      </span>
                    </td>
                    <td className="font-mono" style={{ padding: '10px 10px' }}>
                      {chk.httpCode}
                    </td>
                    <td className="tabular-nums font-mono" style={{ padding: '10px 10px' }}>
                      {chk.latencyMs}ms
                    </td>
                    <td style={{ padding: '10px 10px', color: chk.error ? 'var(--status-down)' : 'var(--text-muted)' }}>
                      {chk.error || 'None (200 OK)'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Monitor Incidents (Strict contract fields: startedAt, resolvedAt, state) */}
        <div className="card-surface" style={{ padding: '20px' }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '14px' }}>
            Incidents for this Monitor
          </h3>
          {incidents.length === 0 ? (
            <div style={{ padding: '30px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              <CheckCircle2 size={24} color="var(--status-up)" style={{ margin: '0 auto 8px auto' }} />
              No incidents recorded for this target in the past 30 days.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {incidents.map((inc) => {
                const duration = formatDuration(inc.startedAt, inc.resolvedAt);

                return (
                  <div
                    key={inc.id}
                    style={{
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-md)',
                      backgroundColor: 'var(--bg-surface-elevated)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                        {inc.monitorName}
                      </span>
                      <span
                        className="font-mono"
                        style={{
                          fontSize: '0.7rem',
                          padding: '2px 6px',
                          borderRadius: 'var(--radius-sm)',
                          backgroundColor: inc.state === 'RESOLVED' ? 'rgba(52, 211, 153, 0.15)' : 'rgba(244, 63, 94, 0.15)',
                          color: inc.state === 'RESOLVED' ? 'var(--status-up)' : 'var(--status-down)',
                          fontWeight: 600,
                        }}
                      >
                        {inc.state}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                      <span>Started: {new Date(inc.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</span>
                      <span>Duration: {duration}</span>
                    </div>
                    {inc.rootCause && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginTop: '2px' }}>
                        Diagnostic: {inc.rootCause}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      <MonitorModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        monitorToEdit={monitor}
        onSuccess={loadData}
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={handleDelete}
        title="Delete Monitor"
        message={`Are you sure you want to permanently delete "${monitor.name}" (${monitor.url})? All 90-day history and synthetic probe records will be permanently expunged.`}
        confirmText="Delete Monitor"
        isDestructive={true}
      />
    </div>
  );
}

function formatDuration(startStr, endStr) {
  if (!startStr) return '—';
  const start = new Date(startStr).getTime();
  const end = endStr ? new Date(endStr).getTime() : Date.now();
  const diffSec = Math.max(0, Math.floor((end - start) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (!endStr) return `${mins}m ${secs}s (ongoing)`;
  return `${mins}m ${secs}s`;
}
