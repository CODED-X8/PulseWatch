import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { HeartbeatLine } from '../components/HeartbeatLine';
import { StatusBadge } from '../components/StatusBadge';
import { UptimeStrip } from '../components/UptimeStrip';
import { Sparkline } from '../components/Sparkline';
import { Skeleton } from '../components/Skeleton';
import { MonitorModal } from '../components/MonitorModal';
import {
  Plus,
  Search,
  Filter,
  RefreshCw,
  Pause,
  Play,
  ArrowUpRight,
  ShieldCheck,
  AlertOctagon,
  Activity,
  Radio,
  ExternalLink,
} from 'lucide-react';

export function DashboardPage() {
  const navigate = useNavigate();
  const { addToast, isAutoRefreshPaused, setIsAutoRefreshPaused, setApiReachable } = useApp();

  const [summary, setSummary] = useState(null);
  const [monitors, setMonitors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(Date.now());
  const [secondsAgo, setSecondsAgo] = useState(0);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Modal
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Fetch data
  const fetchData = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const [sumRes, monRes] = await Promise.all([api.getSummary(), api.getMonitors()]);
      setSummary(sumRes);
      setMonitors(monRes);
      setLastRefreshedAt(Date.now());
      setSecondsAgo(0);
      setApiReachable(true);
    } catch (err) {
      console.error('Fetch error:', err);
      setApiReachable(false);
    } finally {
      setLoading(false);
    }
  }, [setApiReachable]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Periodic poll (10s)
  useEffect(() => {
    if (isAutoRefreshPaused) return;

    const interval = setInterval(() => {
      fetchData(true);
    }, 10000);

    return () => clearInterval(interval);
  }, [isAutoRefreshPaused, fetchData]);

  // "Updated X seconds ago" ticker
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastRefreshedAt) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, [lastRefreshedAt]);

  // Filtered monitors
  const filteredMonitors = useMemo(() => {
    return monitors.filter((m) => {
      const matchSearch =
        m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.url.toLowerCase().includes(searchQuery.toLowerCase());

      const matchStatus =
        statusFilter === 'ALL' ? true : m.state === statusFilter;

      return matchSearch && matchStatus;
    });
  }, [monitors, searchQuery, statusFilter]);

  // Any down monitor for incident banner
  const downMonitors = useMemo(() => monitors.filter((m) => m.state === 'DOWN'), [monitors]);
  const suspectedMonitors = useMemo(() => monitors.filter((m) => m.state === 'SUSPECTED'), [monitors]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Top Banner if Outage / Suspected */}
      {downMonitors.length > 0 && (
        <div
          style={{
            padding: '12px 18px',
            backgroundColor: 'rgba(244, 63, 94, 0.12)',
            border: '1px solid rgba(244, 63, 94, 0.35)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            color: 'var(--status-down)',
            animation: 'fadeIn 200ms ease-out',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AlertOctagon size={18} />
            <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
              Active Critical Incident: {downMonitors.length} monitor(s) confirmed DOWN. Multi-AZ Step Functions retry sequence initiated.
            </span>
          </div>
          <button
            onClick={() => navigate('/incidents')}
            className="btn-danger"
            style={{ padding: '4px 12px', fontSize: '0.75rem' }}
          >
            Investigate Incident
          </button>
        </div>
      )}

      {suspectedMonitors.length > 0 && downMonitors.length === 0 && (
        <div
          style={{
            padding: '12px 18px',
            backgroundColor: 'rgba(251, 191, 36, 0.12)',
            border: '1px solid rgba(251, 191, 36, 0.35)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: 'var(--status-suspected)',
            animation: 'fadeIn 200ms ease-out',
          }}
        >
          <Radio size={18} className="pulse-anim" />
          <span style={{ fontSize: '0.85rem', fontWeight: 600 }}>
            Re-checking to confirm: {suspectedMonitors.map((m) => m.name).join(', ')} reported packet loss. Evaluating second probe.
          </span>
        </div>
      )}

      {/* 4 Stat Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '16px' }}>
        {/* Card 1: Monitors Up */}
        <div className="card-surface" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Monitors Up</span>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: 'var(--status-up)',
                boxShadow: '0 0 8px var(--status-up)',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '10px' }}>
            <span className="tabular-nums font-mono" style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {loading ? <Skeleton width="48px" height="32px" /> : summary?.up || 0}
            </span>
            <Sparkline data={[2, 3, 4, 4, 5, 5, summary?.up || 5]} color="var(--status-up)" />
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Operational targets in worker rotation
          </span>
        </div>

        {/* Card 2: Monitors Down */}
        <div className="card-surface" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Outages / Down</span>
            <div
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: (summary?.down || 0) > 0 ? 'var(--status-down)' : 'var(--text-muted)',
                boxShadow: (summary?.down || 0) > 0 ? '0 0 8px var(--status-down)' : 'none',
              }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '10px' }}>
            <span
              className="tabular-nums font-mono"
              style={{
                fontSize: '1.8rem',
                fontWeight: 700,
                color: (summary?.down || 0) > 0 ? 'var(--status-down)' : 'var(--text-primary)',
              }}
            >
              {loading ? <Skeleton width="48px" height="32px" /> : summary?.down || 0}
            </span>
            <Sparkline data={[0, 0, 1, 0, 0, summary?.down || 0]} color="var(--status-down)" />
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            {summary?.suspected ? `${summary.suspected} suspected blip(s)` : 'Zero active degradation'}
          </span>
        </div>

        {/* Card 3: Uptime 24h */}
        <div className="card-surface" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Global Uptime (24h)</span>
            <ShieldCheck size={16} color="var(--accent-cyan)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '10px' }}>
            <span className="tabular-nums font-mono" style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {loading ? <Skeleton width="80px" height="32px" /> : `${summary?.uptime24h || 100}%`}
            </span>
            <Sparkline data={[99.9, 99.8, 99.9, 99.95, summary?.uptime24h || 99.9]} color="var(--accent-cyan)" />
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Across all monitored endpoints
          </span>
        </div>

        {/* Card 4: Avg Latency */}
        <div className="card-surface" style={{ padding: '18px 20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 500 }}>Average Latency</span>
            <Activity size={16} color="var(--accent-indigo)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: '10px' }}>
            <span className="tabular-nums font-mono" style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {loading ? <Skeleton width="60px" height="32px" /> : `${summary?.avgLatency24h || 48}ms`}
            </span>
            <Sparkline data={summary?.spark || [45, 48, 52, 47, 46]} color="var(--accent-indigo)" />
          </div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
            Synthesized edge probe response
          </span>
        </div>
      </div>

      {/* Control Bar: Search + Status Filter + Auto-Refresh + Add Monitor */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', flex: 1, minWidth: '280px' }}>
          {/* Search */}
          <div style={{ position: 'relative', width: '260px' }}>
            <input
              type="text"
              placeholder="Search monitors or URLs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px 8px 32px',
                backgroundColor: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--text-primary)',
                fontSize: '0.84rem',
              }}
            />
            <Search size={14} color="var(--text-muted)" style={{ position: 'absolute', left: '10px', top: '10px' }} />
          </div>

          {/* Status Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {['ALL', 'UP', 'SUSPECTED', 'DOWN', 'PAUSED'].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                style={{
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.75rem',
                  fontWeight: statusFilter === st ? 600 : 400,
                  backgroundColor: statusFilter === st ? 'rgba(99, 102, 241, 0.15)' : 'transparent',
                  border: statusFilter === st ? '1px solid rgba(99, 102, 241, 0.35)' : '1px solid transparent',
                  color: statusFilter === st ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  cursor: 'pointer',
                }}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {/* Refresh status */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.74rem',
              color: 'var(--text-muted)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>Updated {secondsAgo}s ago</span>
            <button
              onClick={() => setIsAutoRefreshPaused(!isAutoRefreshPaused)}
              title={isAutoRefreshPaused ? 'Resume auto-refresh' : 'Pause auto-refresh'}
              style={{
                background: 'transparent',
                border: 'none',
                color: isAutoRefreshPaused ? 'var(--status-suspected)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
              }}
            >
              {isAutoRefreshPaused ? <Play size={12} /> : <Pause size={12} />}
            </button>
            <button
              onClick={() => fetchData()}
              title="Refresh now"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                padding: '2px',
              }}
            >
              <RefreshCw size={12} />
            </button>
          </div>

          {/* Add Monitor Button */}
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px' }}
          >
            <Plus size={15} />
            <span>Add Monitor</span>
          </button>
        </div>
      </div>

      {/* Monitors Grid */}
      {loading ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="card-surface" style={{ padding: '20px' }}>
              <Skeleton width="60%" height="20px" />
              <div style={{ marginTop: '12px' }}>
                <Skeleton width="100%" height="32px" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredMonitors.length === 0 ? (
        <div
          className="card-surface"
          style={{
            padding: '60px 20px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px',
          }}
        >
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '50%',
              backgroundColor: 'var(--bg-surface-elevated)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            <Activity size={24} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>No monitors found</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
              {monitors.length === 0
                ? 'No monitors yet. Add your first URL to begin telemetry tracking.'
                : 'No targets match the active filter or search query.'}
            </p>
          </div>
          {monitors.length === 0 && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              <Plus size={15} />
              <span>Add Your First URL</span>
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '16px' }}>
          {filteredMonitors.map((mon) => {
            const lastCheckedFormatted = formatTimeAgo(mon.lastCheckedAt);

            return (
              <div
                key={mon.id}
                className="card-surface"
                onClick={() => navigate(`/monitors/${mon.id}`)}
                style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  cursor: 'pointer',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* Card Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3
                      style={{
                        fontSize: '0.98rem',
                        fontWeight: 600,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {mon.name}
                    </h3>
                    <div
                      className="font-mono text-muted"
                      style={{
                        fontSize: '0.74rem',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        marginTop: '2px',
                      }}
                    >
                      {mon.url}
                    </div>
                  </div>
                  <StatusBadge state={mon.state} size="sm" />
                </div>

                {/* Heartbeat Line & Metrics Row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    backgroundColor: 'var(--bg-surface-elevated)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-subtle)',
                  }}
                >
                  <HeartbeatLine status={mon.state} width={90} height={20} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.78rem' }}>
                    <div>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>Latency: </span>
                      <span className="tabular-nums font-mono" style={{ fontWeight: 600 }}>
                        {mon.state === 'DOWN' ? '—' : `${mon.lastLatencyMs || 0}ms`}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted" style={{ fontSize: '0.7rem' }}>24h: </span>
                      <span className="tabular-nums font-mono" style={{ fontWeight: 600, color: 'var(--accent-cyan)' }}>
                        {mon.uptime24h || 100}%
                      </span>
                    </div>
                  </div>
                </div>

                {/* 30-Segment Strip (Mini view) */}
                <div>
                  <UptimeStrip strip={mon.strip.slice(-30)} height={16} showLabels={false} />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.68rem',
                      color: 'var(--text-muted)',
                      marginTop: '6px',
                    }}
                  >
                    <span>Last checked {lastCheckedFormatted}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                      Detail <ArrowUpRight size={11} />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Monitor Modal */}
      <MonitorModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={() => fetchData(true)}
      />
    </div>
  );
}

function formatTimeAgo(isoString) {
  if (!isoString) return 'never';
  const sec = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
  if (sec < 5) return 'just now';
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
