import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      style={{
        padding: '80px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: '50%',
          backgroundColor: 'rgba(244, 63, 94, 0.12)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--status-down)',
          marginBottom: '16px',
        }}
      >
        <AlertCircle size={28} />
      </div>
      <h1 className="font-mono" style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--text-primary)' }}>
        404
      </h1>
      <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginTop: '6px', maxWidth: '380px' }}>
        The requested telemetry route does not exist or has been relocated to another cluster partition.
      </p>
      <button
        onClick={() => navigate('/dashboard')}
        className="btn-primary"
        style={{ marginTop: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}
      >
        <ArrowLeft size={16} />
        <span>Return to Dashboard</span>
      </button>
    </div>
  );
}
