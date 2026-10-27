/**
 * Mock Data Storage & Seed Engine
 * Persisted in browser localStorage under 'pulsewatch_mock_db_v1'
 * Matches docs/API_CONTRACT.md strictly.
 */

const STORAGE_KEY = 'pulsewatch_mock_db_v1';

export function getMockStorage() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = createInitialSeed();
    saveMockStorage(seeded);
    return seeded;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    const seeded = createInitialSeed();
    saveMockStorage(seeded);
    return seeded;
  }
}

export function saveMockStorage(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function createInitialSeed() {
  const now = Date.now();
  const ONE_MIN = 60 * 1000;
  const ONE_HOUR = 60 * ONE_MIN;
  const ONE_DAY = 24 * ONE_HOUR;

  // Generate 90-segment strip for a monitor
  const generateStrip = (healthyRate = 0.98) => {
    const strip = [];
    for (let i = 0; i < 90; i++) {
      if (Math.random() < healthyRate) {
        strip.push('up');
      } else {
        strip.push(Math.random() > 0.5 ? 'down' : 'up');
      }
    }
    return strip;
  };

  // Seed 6 realistic monitors strictly matching contract
  const monitors = [
    {
      id: 'mon-001',
      name: 'Production Auth Gateway',
      url: 'https://auth.pulsewatch.dev/v1/health',
      intervalMin: 1,
      expectedStatus: 200,
      timeoutSec: 5,
      state: 'UP',
      lastCheckedAt: new Date(now - 12000).toISOString(),
      lastLatencyMs: 42,
      uptime24h: 99.98,
      strip: generateStrip(0.99),
      heartbeat: 'steady',
    },
    {
      id: 'mon-002',
      name: 'Primary API Cluster (EKS)',
      url: 'https://api.pulsewatch.dev/healthz',
      intervalMin: 5,
      expectedStatus: 200,
      timeoutSec: 10,
      state: 'UP',
      lastCheckedAt: new Date(now - 34000).toISOString(),
      lastLatencyMs: 78,
      uptime24h: 99.85,
      strip: generateStrip(0.98),
      heartbeat: 'steady',
    },
    {
      id: 'mon-003',
      name: 'Payment Webhook Receiver',
      url: 'https://pay.pulsewatch.dev/stripe/webhook',
      intervalMin: 5,
      expectedStatus: 200,
      timeoutSec: 10,
      state: 'UP',
      lastCheckedAt: new Date(now - 8000).toISOString(),
      lastLatencyMs: 115,
      uptime24h: 99.64,
      strip: generateStrip(0.97),
      heartbeat: 'steady',
    },
    {
      id: 'mon-004',
      name: 'Realtime WebSocket Ingress',
      url: 'https://ws.pulsewatch.dev/status',
      intervalMin: 1,
      expectedStatus: 200,
      timeoutSec: 5,
      state: 'UP',
      lastCheckedAt: new Date(now - 19000).toISOString(),
      lastLatencyMs: 31,
      uptime24h: 99.99,
      strip: generateStrip(0.995),
      heartbeat: 'steady',
    },
    {
      id: 'mon-005',
      name: 'CDN Asset Edge Cache',
      url: 'https://assets.pulsewatch.dev/ping.txt',
      intervalMin: 15,
      expectedStatus: 200,
      timeoutSec: 10,
      state: 'UP',
      lastCheckedAt: new Date(now - 145000).toISOString(),
      lastLatencyMs: 18,
      uptime24h: 100.0,
      strip: generateStrip(1.0),
      heartbeat: 'steady',
    },
    {
      id: 'mon-006',
      name: 'Internal Metrics Prometheus',
      url: 'https://metrics.pulsewatch.dev/-/healthy',
      intervalMin: 5,
      expectedStatus: 200,
      timeoutSec: 10,
      state: 'PAUSED',
      lastCheckedAt: new Date(now - 4500000).toISOString(),
      lastLatencyMs: 55,
      uptime24h: 99.12,
      strip: generateStrip(0.95),
      heartbeat: 'steady',
    },
  ];

  // Seed 3 past incidents strictly matching contract: {id, monitorId, monitorName, startedAt, resolvedAt, state}
  // Optional field: rootCause
  const incidents = [
    {
      id: 'inc-101',
      monitorId: 'mon-002',
      monitorName: 'Primary API Cluster (EKS)',
      startedAt: new Date(now - 4 * ONE_DAY).toISOString(),
      resolvedAt: new Date(now - 4 * ONE_DAY + 8 * ONE_MIN).toISOString(),
      state: 'RESOLVED',
      rootCause: 'Connection pool saturation on RDS Read Replica during scheduled index re-build.',
    },
    {
      id: 'inc-102',
      monitorId: 'mon-003',
      monitorName: 'Payment Webhook Receiver',
      startedAt: new Date(now - 12 * ONE_DAY).toISOString(),
      resolvedAt: new Date(now - 12 * ONE_DAY + 4 * ONE_MIN + 30000).toISOString(),
      state: 'RESOLVED',
      rootCause: 'Upstream gateway 504 Gateway Timeout during DNS failover sequence.',
    },
    {
      id: 'inc-103',
      monitorId: 'mon-001',
      monitorName: 'Production Auth Gateway',
      startedAt: new Date(now - 22 * ONE_DAY).toISOString(),
      resolvedAt: new Date(now - 22 * ONE_DAY + 14 * ONE_MIN).toISOString(),
      state: 'RESOLVED',
      rootCause: 'OOM kill on ECS container task following burst spike in credential refresh requests.',
    },
  ];

  // Pre-seed history for each monitor
  const history = {};
  monitors.forEach(mon => {
    history[mon.id] = generateHistoryForMonitor(mon.id, now);
  });

  // Seed system reactor metrics (Worker ASG baseline: 1 worker; scales 1 -> 3)
  const system = {
    instanceId: 'i-09ab7f4122dca8f10',
    az: 'ap-south-1a',
    queueDepth: 4,
    inFlight: 2,
    dlq: 0,
    workers: [
      { id: 'wrk-01', az: 'ap-south-1a', status: 'HEALTHY', activeChecks: 2, cpuPercent: 28, lastHeartbeatSec: 2 },
    ],
    deps: {
      rds: 'HEALTHY',
      ddb: 'HEALTHY',
      sqs: 'HEALTHY',
    },
    loadTestActive: false,
  };

  return {
    user: {
      id: 'usr_dev_01',
      email: 'dev@pulsewatch.internal',
      name: 'Lead Site Reliability Engineer',
      role: 'Admin',
    },
    monitors,
    incidents,
    history,
    system,
    forcedDownIds: [],
  };
}

function generateHistoryForMonitor(monitorId, now) {
  const points = [];
  const ONE_MIN = 60 * 1000;
  const ONE_HOUR = 60 * ONE_MIN;
  const ONE_DAY = 24 * ONE_HOUR;

  for (let i = 60; i >= 0; i--) {
    const ts = now - i * ONE_MIN;
    const baseLatency = monitorId === 'mon-005' ? 18 : monitorId === 'mon-004' ? 32 : monitorId === 'mon-001' ? 45 : 75;
    const jitter = Math.floor(Math.sin(i / 5) * 8 + (Math.random() * 12 - 6));
    points.push({
      ts: new Date(ts).toISOString(),
      status: 'UP',
      httpCode: 200,
      latencyMs: Math.max(12, baseLatency + jitter),
      error: null,
    });
  }

  for (let i = 48; i >= 2; i--) {
    const ts = now - i * 30 * ONE_MIN;
    const baseLatency = 45;
    const jitter = Math.floor(Math.random() * 18 - 9);
    points.push({
      ts: new Date(ts).toISOString(),
      status: 'UP',
      httpCode: 200,
      latencyMs: Math.max(15, baseLatency + jitter),
      error: null,
    });
  }

  for (let d = 30; d >= 2; d--) {
    const ts = now - d * ONE_DAY;
    points.push({
      ts: new Date(ts).toISOString(),
      status: 'UP',
      httpCode: 200,
      latencyMs: 44 + Math.floor(Math.random() * 10),
      error: null,
    });
  }

  points.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  return points;
}
