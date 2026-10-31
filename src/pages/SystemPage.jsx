import React, { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client';
import { useApp } from '../context/AppContext';
import { devPanel } from '../mock/engine';
import { Skeleton } from '../components/Skeleton';
import {
  Server,
  Layers,
  Database,
  Cpu,
  Zap,
  Activity,
  ShieldCheck,
  RefreshCw,
  HardDrive,
  Radio,
  Clock,
} from 'lucide-react';

export function SystemPage() {
  const { addToast } = useApp();
  const [system, setSystem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isLoadTesting, setIsLoadTesting] = useState(false);

  const fetchSystem = useCallback(async () => {
    try {
      const data = await api.getSystemStatus();
      setSystem(data);
    } catch (err) {
      console.error('System fetch failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSystem();
    // 5-second reactor panel poll
    const interval = setInterval(() => {
      fetchSystem();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchSystem]);

  const handleRunLoadTest = () => {
    setIsLoadTesting(true);
    devPanel.triggerLoadTest();
    addToast('Spiking SQS queue to 480 jobs. Auto Scaling Group scaling out workers...', 'warning');
    setTimeout(() => {
      fetchSystem();
      setIsLoadTesting(false);
    }, 800);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Page Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
        <div>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
            System Reactor & Worker Fleet
          </h1>
          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
            Live distributed telemetry: EC2 API instance host, SQS message queue depths, and multi-AZ worker ASG nodes
          </p>
        </div>

        <button
          onClick={handleRunLoadTest}
          disabled={isLoadTesting || system?.loadTestActive}
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}
        >
          <Zap size={15} />
          <span>{isLoadTesting || system?.loadTestActive ? 'Load Test in Flight...' : 'Run Load Test'}</span>
        </button>
      </div>

      {/* Row 1: Served By & Queue Depths */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        {/* Served By Card */}
        <div className="card-surface" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
            <Server size={16} color="var(--accent-indigo)" />
            <span>Serving API Instance</span>
          </div>
          <div style={{ marginTop: '12px' }}>
            <div className="font-mono" style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {loading ? <Skeleton width="180px" height="26px" /> : system?.instanceId}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px', fontSize: '0.78rem' }}>
              <span className="text-muted">Availability Zone:</span>
              <span
                className="font-mono"
                style={{
                  padding: '1px 6px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'rgba(34, 211, 238, 0.1)',
                  color: 'var(--accent-cyan)',
                  fontWeight: 600,
                }}
              >
                {system?.az || 'ap-south-1a'}
              </span>
            </div>
          </div>
        </div>

        {/* SQS Queue Depth */}
        <div className="card-surface" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
            <Layers size={16} color="var(--accent-cyan)" />
            <span>SQS Ingress Queue Depth</span>
          </div>
          <div style={{ marginTop: '12px' }}>
            <div className="tabular-nums font-mono" style={{ fontSize: '1.5rem', fontWeight: 700, color: (system?.queueDepth || 0) > 50 ? 'var(--status-suspected)' : 'var(--text-primary)' }}>
              {loading ? <Skeleton width="80px" height="26px" /> : `${system?.queueDepth || 0} msgs`}
            </div>
            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '6px' }}>
              Pending execution in SQS check broker
            </div>
          </div>
        </div>

        {/* In-Flight & DLQ */}
        <div className="card-surface" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 600 }}>
            <Activity size={16} color="var(--status-up)" />
            <span>In-Flight & Dead Letter Queue</span>
          </div>
          <div style={{ marginTop: '12px', display: 'flex', gap: '20px' }}>
            <div>
              <span className="text-muted" style={{ fontSize: '0.72rem', display: 'block' }}>In-Flight:</span>
              <span className="tabular-nums font-mono" style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                {system?.inFlight || 0}
              </span>
            </div>
            <div>
              <span className="text-muted" style={{ fontSize: '0.72rem', display: 'block' }}>DLQ (Poison):</span>
              <span
                className="tabular-nums font-mono"
                style={{
                  fontSize: '1.3rem',
                  fontWeight: 700,
                  color: (system?.dlq || 0) > 0 ? 'var(--status-down)' : 'var(--status-up)',
                }}
              >
                {system?.dlq || 0}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Worker Fleet Nodes (Glowing Nodes that appear as Auto Scaling occurs) */}
      <div className="card-surface" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '18px' }}>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)' }}>
              Synthetic Worker Fleet (EC2 Auto Scaling)
            </h3>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Target nodes polling SQS jobs and measuring latency across multiple regions
            </p>
          </div>
          <span
            className="font-mono"
            style={{
              fontSize: '0.75rem',
              padding: '4px 10px',
              borderRadius: 'var(--radius-full)',
              backgroundColor: 'rgba(99, 102, 241, 0.15)',
              color: 'var(--accent-cyan)',
              fontWeight: 600,
            }}
          >
            {system?.workers ? `${system.workers.length} / 3 Nodes Active (Max: 3)` : '—'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {system?.workers?.map((w, idx) => {
            const isScaledOut = w.status === 'SCALED_OUT';

            return (
              <div
                key={w.id || idx}
                style={{
                  padding: '16px',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--bg-surface-elevated)',
                  border: isScaledOut ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                  boxShadow: isScaledOut ? '0 0 16px rgba(34, 211, 238, 0.15)' : 'none',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  animation: 'fadeIn 300ms ease-out',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div
                      style={{
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--status-up)',
                        boxShadow: '0 0 8px var(--status-up)',
                      }}
                    />
                    <span className="font-mono" style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {w.id}
                    </span>
                  </div>
                  <span
                    className="font-mono text-muted"
                    style={{
                      fontSize: '0.7rem',
                      padding: '2px 6px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                    }}
                  >
                    {w.az}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'var(--text-secondary)' }}>
                  <span>Active Probes: <strong className="font-mono tabular-nums">{w.activeChecks}</strong></span>
                  <span>CPU Load: <strong className="font-mono tabular-nums">{w.cpuPercent}%</strong></span>
                </div>

                <div style={{ width: '100%', height: '4px', backgroundColor: 'var(--border-subtle)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${w.cpuPercent}%`,
                      backgroundColor: w.cpuPercent > 80 ? 'var(--status-suspected)' : 'var(--status-up)',
                      transition: 'width 300ms ease-out',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Core AWS Infrastructure Dependencies */}
      <div className="card-surface" style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Core Infrastructure Health & Subsystems
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
          Status of persistent database backends and messaging queues
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
          {/* RDS PostgreSQL */}
          <div
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Database size={20} color="var(--accent-indigo)" />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>Amazon RDS PostgreSQL</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Multi-AZ Replica Cluster</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--status-up)',
                  boxShadow: '0 0 6px var(--status-up)',
                }}
              />
              <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--status-up)', fontWeight: 600 }}>HEALTHY</span>
            </div>
          </div>

          {/* DynamoDB */}
          <div
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <HardDrive size={20} color="var(--accent-cyan)" />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>Amazon DynamoDB</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Timeseries & Streams TTL</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: system?.deps?.ddb === 'DEGRADED' ? 'var(--status-suspected)' : 'var(--status-up)',
                  boxShadow: system?.deps?.ddb === 'DEGRADED' ? '0 0 6px var(--status-suspected)' : '0 0 6px var(--status-up)',
                }}
              />
              <span
                className="font-mono"
                style={{
                  fontSize: '0.75rem',
                  color: system?.deps?.ddb === 'DEGRADED' ? 'var(--status-suspected)' : 'var(--status-up)',
                  fontWeight: 600,
                }}
              >
                {system?.deps?.ddb || 'HEALTHY'}
              </span>
            </div>
          </div>

          {/* Amazon SQS */}
          <div
            style={{
              padding: '16px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'var(--bg-surface-elevated)',
              border: '1px solid var(--border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <Layers size={20} color="var(--accent-indigo)" />
              <div>
                <div style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--text-primary)' }}>Amazon SQS Standard</div>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Dead-Letter Queue configured</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--status-up)',
                  boxShadow: '0 0 6px var(--status-up)',
                }}
              />
              <span className="font-mono" style={{ fontSize: '0.75rem', color: 'var(--status-up)', fontWeight: 600 }}>HEALTHY</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
