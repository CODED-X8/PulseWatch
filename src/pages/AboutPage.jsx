import React, { useState } from 'react';
import {
  Cloud,
  Server,
  Database,
  Layers,
  Shield,
  Bell,
  Cpu,
  GitBranch,
  Lock,
  Eye,
  CheckCircle2,
} from 'lucide-react';

export function AboutPage() {
  const [selectedService, setSelectedService] = useState('cf');

  const services = {
    cf: {
      name: 'Amazon CloudFront & S3',
      role: 'Global Edge Ingress & Static Hosting',
      details:
        'Serves the compiled single-page application from a private S3 bucket with Origin Access Control (OAC). Directly routes any /api/* request patterns transparently to the Application Load Balancer.',
      region: 'Global Edge PoPs',
    },
    alb: {
      name: 'Application Load Balancer (ALB)',
      role: 'Layer 7 High-Throughput Routing',
      details:
        'Terminates TLS with ACM certificates and performs round-robin routing across healthy EC2 API instances spanning multiple Availability Zones (ap-south-1a, 1b, 1c).',
      region: 'ap-south-1',
    },
    ec2_api: {
      name: 'EC2 API Auto Scaling Group',
      role: 'RESTful API & Client Gateway',
      details:
        'Stateless Node/Go API services running in private subnets. Authenticates requests via JWT, handles monitor CRUD operations, and dispatches cron tick jobs into Amazon SQS.',
      region: 'ap-south-1',
    },
    sqs: {
      name: 'Amazon SQS with Dead-Letter Queue',
      role: 'Asynchronous Probe Job Buffer',
      details:
        'Buffers check tasks generated every 1/5/15 minutes. Decouples the API scheduler from worker probe execution. Unprocessable or poison messages are isolated in a DLQ.',
      region: 'ap-south-1',
    },
    workers: {
      name: 'EC2 Worker Fleet Auto Scaling',
      role: 'Synthetic Probe Execution Engine',
      details:
        'Worker instances pull jobs from SQS, fire HTTP/HTTPS synthetic probes against configured endpoints, record latency with microsecond accuracy, and write results directly to DynamoDB.',
      region: 'ap-south-1',
    },
    dynamo: {
      name: 'Amazon DynamoDB & Streams',
      role: 'High-Velocity Timeseries & Outage Detection',
      details:
        'Stores every synthetic check result with automatic 90-day TTL expiration. When a check fails, DynamoDB Streams immediately invokes the Step Functions workflow.',
      region: 'ap-south-1',
    },
    step_functions: {
      name: 'AWS Step Functions',
      role: 'Multi-AZ Outage Confirmation Workflow',
      details:
        'State machine that orchestrates second-probe verification from an alternate AZ. Prevents false alarms by enforcing the SUSPECTED state before declaring DOWN.',
      region: 'ap-south-1',
    },
    sns: {
      name: 'Amazon SNS',
      role: 'Multi-Channel Incident Dispatcher',
      details:
        'Broadcasts high-priority alert notifications to engineering teams via Email, Webhooks, and PagerDuty immediately upon confirmed outage status transition.',
      region: 'ap-south-1',
    },
    rds: {
      name: 'Amazon RDS PostgreSQL',
      role: 'Relational System of Record',
      details:
        'Stores user credentials, organizational permissions, monitor definitions, notification webhooks, and incident audit logs with automated Multi-AZ failover.',
      region: 'ap-south-1',
    },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {/* Header */}
      <div>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          Cloud Architecture & AWS Infrastructure
        </h1>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          Production design blueprint for high-precision synthetic uptime monitoring in AWS ap-south-1
        </p>
      </div>

      {/* Interactive SVG Architecture Diagram */}
      <div className="card-surface" style={{ padding: '24px', overflowX: 'auto' }}>
        <h3 style={{ fontSize: '0.98rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
          Distributed System Topology Diagram
        </h3>
        <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '18px' }}>
          Click any component node in the diagram below to inspect its operational role and AWS implementation details.
        </p>

        <div style={{ minWidth: '780px', position: 'relative' }}>
          <svg viewBox="0 0 880 340" style={{ width: '100%', height: 'auto', display: 'block' }}>
            <defs>
              <linearGradient id="edgeGlow" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="var(--accent-indigo)" />
                <stop offset="100%" stopColor="var(--accent-cyan)" />
              </linearGradient>
            </defs>

            {/* Connecting lines */}
            <path d="M 120 170 L 220 170" stroke="var(--border-highlight)" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M 330 170 L 410 170" stroke="var(--border-highlight)" strokeWidth="2" />
            <path d="M 465 130 L 465 75 L 560 75" stroke="var(--border-highlight)" strokeWidth="2" />
            <path d="M 520 170 L 580 170" stroke="var(--border-highlight)" strokeWidth="2" />
            <path d="M 690 170 L 740 170" stroke="var(--border-highlight)" strokeWidth="2" />
            <path d="M 795 210 L 795 265 L 690 265" stroke="var(--status-down)" strokeWidth="2" strokeDasharray="4 4" />
            <path d="M 580 265 L 490 265" stroke="var(--status-suspected)" strokeWidth="2" />

            {/* Node 1: CloudFront / S3 */}
            <g onClick={() => setSelectedService('cf')} style={{ cursor: 'pointer' }}>
              <rect
                x="20"
                y="130"
                width="100"
                height="80"
                rx="10"
                fill={selectedService === 'cf' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'cf' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="70" y="165" fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                CloudFront
              </text>
              <text x="70" y="185" fill="var(--text-muted)" fontSize="9" textAnchor="middle">
                + S3 Origin
              </text>
            </g>

            {/* Node 2: ALB */}
            <g onClick={() => setSelectedService('alb')} style={{ cursor: 'pointer' }}>
              <rect
                x="220"
                y="130"
                width="110"
                height="80"
                rx="10"
                fill={selectedService === 'alb' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'alb' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="275" y="165" fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                ALB Ingress
              </text>
              <text x="275" y="185" fill="var(--text-muted)" fontSize="9" textAnchor="middle">
                Multi-AZ Layer 7
              </text>
            </g>

            {/* Node 3: EC2 API */}
            <g onClick={() => setSelectedService('ec2_api')} style={{ cursor: 'pointer' }}>
              <rect
                x="410"
                y="130"
                width="110"
                height="80"
                rx="10"
                fill={selectedService === 'ec2_api' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'ec2_api' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="465" y="165" fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                EC2 API ASG
              </text>
              <text x="465" y="185" fill="var(--text-muted)" fontSize="9" textAnchor="middle">
                Node / Go Fleet
              </text>
            </g>

            {/* Node 4: RDS PostgreSQL (Top) */}
            <g onClick={() => setSelectedService('rds')} style={{ cursor: 'pointer' }}>
              <rect
                x="560"
                y="35"
                width="130"
                height="80"
                rx="10"
                fill={selectedService === 'rds' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'rds' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="625" y="70" fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                RDS PostgreSQL
              </text>
              <text x="625" y="90" fill="var(--text-muted)" fontSize="9" textAnchor="middle">
                Users & Monitors
              </text>
            </g>

            {/* Node 5: SQS Queue */}
            <g onClick={() => setSelectedService('sqs')} style={{ cursor: 'pointer' }}>
              <rect
                x="580"
                y="130"
                width="110"
                height="80"
                rx="10"
                fill={selectedService === 'sqs' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'sqs' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="635" y="165" fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                Amazon SQS
              </text>
              <text x="635" y="185" fill="var(--text-muted)" fontSize="9" textAnchor="middle">
                Probe Task Buffer
              </text>
            </g>

            {/* Node 6: Worker Fleet */}
            <g onClick={() => setSelectedService('workers')} style={{ cursor: 'pointer' }}>
              <rect
                x="740"
                y="130"
                width="110"
                height="80"
                rx="10"
                fill={selectedService === 'workers' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'workers' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="795" y="165" fill="var(--text-primary)" fontSize="11" fontWeight="600" textAnchor="middle">
                Worker Fleet
              </text>
              <text x="795" y="185" fill="var(--text-muted)" fontSize="9" textAnchor="middle">
                Probes Target URLs
              </text>
            </g>

            {/* Node 7: DynamoDB Streams (Bottom right) */}
            <g onClick={() => setSelectedService('dynamo')} style={{ cursor: 'pointer' }}>
              <rect
                x="580"
                y="235"
                width="110"
                height="60"
                rx="8"
                fill={selectedService === 'dynamo' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'dynamo' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="635" y="262" fill="var(--text-primary)" fontSize="10" fontWeight="600" textAnchor="middle">
                DynamoDB
              </text>
              <text x="635" y="278" fill="var(--text-muted)" fontSize="8" textAnchor="middle">
                Streams & TTL
              </text>
            </g>

            {/* Node 8: Step Functions (Bottom left) */}
            <g onClick={() => setSelectedService('step_functions')} style={{ cursor: 'pointer' }}>
              <rect
                x="370"
                y="235"
                width="120"
                height="60"
                rx="8"
                fill={selectedService === 'step_functions' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'step_functions' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="430" y="262" fill="var(--text-primary)" fontSize="10" fontWeight="600" textAnchor="middle">
                Step Functions
              </text>
              <text x="430" y="278" fill="var(--text-muted)" fontSize="8" textAnchor="middle">
                Multi-AZ Outage Logic
              </text>
            </g>

            {/* Node 9: SNS (Bottom far left) */}
            <g onClick={() => setSelectedService('sns')} style={{ cursor: 'pointer' }}>
              <rect
                x="200"
                y="235"
                width="110"
                height="60"
                rx="8"
                fill={selectedService === 'sns' ? 'rgba(99, 102, 241, 0.25)' : 'var(--bg-surface-elevated)'}
                stroke={selectedService === 'sns' ? 'var(--accent-cyan)' : 'var(--border-subtle)'}
                strokeWidth="2"
              />
              <text x="255" y="262" fill="var(--text-primary)" fontSize="10" fontWeight="600" textAnchor="middle">
                Amazon SNS
              </text>
              <text x="255" y="278" fill="var(--text-muted)" fontSize="8" textAnchor="middle">
                Email / Pager Alerts
              </text>
            </g>
          </svg>
        </div>
      </div>

      {/* Selected Component Detail Pane */}
      {selectedService && services[selectedService] && (
        <div
          className="card-surface"
          style={{
            padding: '24px',
            backgroundColor: 'var(--bg-surface-elevated)',
            border: '1px solid var(--accent-indigo)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--text-primary)' }}>
              {services[selectedService].name}
            </h3>
            <span
              className="font-mono"
              style={{
                fontSize: '0.72rem',
                padding: '2px 8px',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'rgba(34, 211, 238, 0.1)',
                color: 'var(--accent-cyan)',
              }}
            >
              {services[selectedService].region}
            </span>
          </div>

          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--accent-cyan)', marginBottom: '8px' }}>
            {services[selectedService].role}
          </div>

          <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {services[selectedService].details}
          </p>
        </div>
      )}

      {/* Security, Compliance & Observability Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        <div className="card-surface" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Lock size={16} color="var(--accent-cyan)" />
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Security & Zero-Secrets</h4>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            API keys and RDS credentials reside in AWS SSM Parameter Store with KMS encryption. No secrets exist in client code, repositories, or static assets.
          </p>
        </div>

        <div className="card-surface" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Eye size={16} color="var(--accent-indigo)" />
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Observability & Governance</h4>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            CloudWatch collects worker metrics and ALB access logs. CloudTrail monitors all IAM API calls, while AWS Budgets tracks regional billing caps.
          </p>
        </div>

        <div className="card-surface" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
            <Shield size={16} color="var(--status-up)" />
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600 }}>Resilient State Machine</h4>
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            A single failed check never trips DOWN. The system moves to SUSPECTED (amber pulsing) and dispatches an alternate AZ probe before confirming an outage.
          </p>
        </div>
      </div>
    </div>
  );
}
