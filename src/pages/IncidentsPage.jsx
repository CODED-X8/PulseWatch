import React, { useState, useEffect } from 'react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { Skeleton } from '../components/Skeleton';
import {
  Download,
  CheckCircle2,
  Flame,
} from 'lucide-react';

export function IncidentsPage() {
  const { addToast } = useApp();
  const [incidents, setIncidents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL'); // 'ALL' | 'OPEN' | 'RESOLVED'
  const [exporting, setExporting] = useState(false);

  const loadIncidents = async () => {
    try {
      setLoading(true);
      const res = await api.getIncidents(filter === 'ALL' ? null : filter.toLowerCase());
      setIncidents(res);
    } catch (err) {
      addToast(err.message || 'Failed to load incidents', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIncidents();
  }, [filter]);

  const handleExport = async () => {
    try {
      setExporting(true);
      const res = await api.exportReport();
      addToast(
        <span>
          CSV report generated!{' '}
          <a
            href={res.downloadUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: '#ffffff', textDecoration: 'underline', fontWeight: 600 }}
          >
            Download CSV Report
          </a>{' '}
          (valid {Math.round(res.expiresInSec / 60)}m)
        </span>,
        'success',
        8000
      );
    } catch (err) {
      addToast(err.message || 'Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            System Incidents
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Historical record of probe failures, multi-AZ confirmation cycles, and resolution duration
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Filter Pills */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 'var(--radius-md)',
              padding: '2px',
            }}
          >
            {['ALL', 'OPEN', 'RESOLVED'].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '5px 12px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.75rem',
                  fontWeight: filter === f ? 600 : 400,
                  backgroundColor: filter === f ? 'var(--bg-surface-elevated)' : 'transparent',
                  color: filter === f ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  border: 'none',
                  cursor: 'pointer',
                  transition: 'all var(--transition-fast)',
                }}
              >
                {f}
              </button>
            ))}
          </div>

          {/* Export Button */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '7px 14px', fontSize: '0.8rem' }}
          >
            <Download size={14} />
            <span>{exporting ? 'Generating...' : 'Export Report'}</span>
          </button>
        </div>
      </div>

      {/* Incidents Table Card */}
      <div className="card-surface" style={{ padding: '0px', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '24px' }}>
            <Skeleton width="100%" height="40px" />
            <div style={{ marginTop: '12px' }}><Skeleton width="100%" height="40px" /></div>
            <div style={{ marginTop: '12px' }}><Skeleton width="100%" height="40px" /></div>
          </div>
        ) : incidents.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <CheckCircle2 size={36} color="var(--status-up)" style={{ margin: '0 auto 12px auto' }} />
            <h3 style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>No incidents logged</h3>
            <p style={{ fontSize: '0.82rem', marginTop: '4px' }}>All systems have operated with zero downtime during this period.</p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--bg-surface-elevated)', borderBottom: '1px solid var(--border-subtle)', textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th style={{ padding: '12px 18px' }}>Target Monitor</th>
                  <th style={{ padding: '12px 18px' }}>State</th>
                  <th style={{ padding: '12px 18px' }}>Started At</th>
                  <th style={{ padding: '12px 18px' }}>Resolved At</th>
                  <th style={{ padding: '12px 18px' }}>Duration</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => {
                  const isOpen = inc.state !== 'RESOLVED';
                  const duration = calculateDuration(inc.startedAt, inc.resolvedAt);

                  return (
                    <tr
                      key={inc.id}
                      style={{
                        borderBottom: '1px solid var(--border-subtle)',
                        backgroundColor: isOpen ? 'rgba(244, 63, 94, 0.04)' : 'transparent',
                      }}
                    >
                      <td style={{ padding: '14px 18px', fontWeight: 600, color: 'var(--text-primary)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          {isOpen ? <Flame size={15} color="var(--status-down)" /> : <CheckCircle2 size={15} color="var(--status-up)" />}
                          <span>{inc.monitorName}</span>
                        </div>
                      </td>

                      <td style={{ padding: '14px 18px' }}>
                        <span
                          className="font-mono"
                          style={{
                            fontSize: '0.72rem',
                            padding: '3px 8px',
                            borderRadius: 'var(--radius-full)',
                            fontWeight: 600,
                            backgroundColor: isOpen ? 'rgba(244, 63, 94, 0.15)' : 'rgba(52, 211, 153, 0.12)',
                            color: isOpen ? 'var(--status-down)' : 'var(--status-up)',
                            border: `1px solid ${isOpen ? 'rgba(244, 63, 94, 0.3)' : 'rgba(52, 211, 153, 0.25)'}`,
                          }}
                        >
                          {inc.state}
                        </span>
                      </td>

                      <td className="font-mono text-muted" style={{ padding: '14px 18px' }}>
                        {new Date(inc.startedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}
                      </td>

                      <td className="font-mono text-muted" style={{ padding: '14px 18px' }}>
                        {inc.resolvedAt
                          ? new Date(inc.resolvedAt).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })
                          : <span style={{ color: 'var(--status-down)', fontWeight: 600 }}>Active Outage</span>}
                      </td>

                      <td className="tabular-nums font-mono" style={{ padding: '14px 18px', fontWeight: 600 }}>
                        {duration}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function calculateDuration(startStr, endStr) {
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
