/**
 * PulseWatch Unified API Client
 * 
 * Strict Single-Source Architecture:
 * - When CONFIG.API_MODE === 'mock', invokes browser mock handlers with 80-300ms simulated network latency.
 * - When CONFIG.API_MODE === 'real', dispatches real fetch() to CONFIG.API_BASE_URL (defaults to empty string for same-origin CloudFront routing).
 * 
 * In real mode:
 * - Sends 'Authorization: Bearer <token>'
 * - 401 redirects to #/login and clears session
 * - AbortController timeout with friendly error
 * - Unified ApiResponseError for seamless UI handling
 */

import { CONFIG } from '../config';
import { getMockStorage, saveMockStorage } from '../mock/storage';
import { startMockSimulationEngine } from '../mock/engine';

if (CONFIG.API_MODE === 'mock') {
  startMockSimulationEngine();
}

export const authStorage = {
  getToken: () => sessionStorage.getItem('pulsewatch_token'),
  setToken: (token) => sessionStorage.setItem('pulsewatch_token', token),
  clearToken: () => sessionStorage.removeItem('pulsewatch_token'),
  getUser: () => {
    const raw = sessionStorage.getItem('pulsewatch_user');
    return raw ? JSON.parse(raw) : null;
  },
  setUser: (user) => sessionStorage.setItem('pulsewatch_user', JSON.stringify(user)),
};

const mockDelay = () => {
  const ms = Math.floor(Math.random() * (300 - 80 + 1)) + 80;
  return new Promise(resolve => setTimeout(resolve, ms));
};

export class ApiResponseError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ApiResponseError';
    this.status = status;
  }
}

export const api = {
  // POST /api/auth/register {email,password} -> {token,user}
  register: async ({ email, password }) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    }
    await mockDelay();
    if (!email || !password || password.length < 6) {
      throw new ApiResponseError('Password must be at least 6 characters long.', 400);
    }
    const token = `jwt_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const user = {
      id: `usr_${Date.now().toString(36)}`,
      email,
      name: email.split('@')[0],
      role: 'Engineer',
    };
    authStorage.setToken(token);
    authStorage.setUser(user);
    return { token, user };
  },

  // POST /api/auth/login {email,password} -> {token,user}
  login: async ({ email, password }) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    }
    await mockDelay();
    if (!email || !password) {
      throw new ApiResponseError('Please provide both email and password.', 400);
    }
    const token = `jwt_mock_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const user = {
      id: 'usr_dev_01',
      email,
      name: email.split('@')[0] || 'Dev User',
      role: 'Admin',
    };
    authStorage.setToken(token);
    authStorage.setUser(user);
    return { token, user };
  },

  // GET /api/summary -> {up,down,suspected,paused,uptime24h,avgLatency24h,spark:[numbers]}
  getSummary: async () => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/summary');
    }
    await mockDelay();
    const db = getMockStorage();
    const monitors = db.monitors || [];

    let up = 0;
    let down = 0;
    let suspected = 0;
    let paused = 0;
    let totalLatency = 0;
    let latencyCount = 0;

    monitors.forEach(m => {
      if (m.state === 'UP') up++;
      else if (m.state === 'DOWN') down++;
      else if (m.state === 'SUSPECTED') suspected++;
      else if (m.state === 'PAUSED') paused++;

      if (m.lastLatencyMs && m.state !== 'DOWN') {
        totalLatency += m.lastLatencyMs;
        latencyCount++;
      }
    });

    const avgLatency24h = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 48;
    const uptime24h = monitors.length > 0 
      ? Number((monitors.reduce((acc, m) => acc + (m.uptime24h || 100), 0) / monitors.length).toFixed(2))
      : 100.0;

    const spark = [44, 46, 42, 48, 45, 49, 52, 47, 46, avgLatency24h];

    return {
      up,
      down,
      suspected,
      paused,
      uptime24h,
      avgLatency24h,
      spark,
    };
  },

  // GET /api/monitors -> [{id,name,url,intervalMin,expectedStatus,timeoutSec,state,lastCheckedAt,lastLatencyMs,uptime24h,strip,heartbeat}]
  getMonitors: async () => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/monitors');
    }
    await mockDelay();
    const db = getMockStorage();
    return db.monitors;
  },

  // POST /api/monitors
  createMonitor: async (monitorData) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/monitors', { method: 'POST', body: JSON.stringify(monitorData) });
    }
    await mockDelay();
    const db = getMockStorage();

    validateMonitorInput(monitorData, db.monitors);

    if (db.monitors.length >= CONFIG.MAX_MONITORS_PER_USER) {
      throw new ApiResponseError(`Monitor limit reached (${CONFIG.MAX_MONITORS_PER_USER} max per account).`, 400);
    }

    const newMonitor = {
      id: `mon-${Date.now().toString().slice(-4)}`,
      name: monitorData.name.trim(),
      url: monitorData.url.trim(),
      intervalMin: Number(monitorData.intervalMin) || 5,
      expectedStatus: Number(monitorData.expectedStatus) || 200,
      timeoutSec: Number(monitorData.timeoutSec) || 10,
      state: 'PENDING',
      lastCheckedAt: new Date().toISOString(),
      lastLatencyMs: 0,
      uptime24h: 100.0,
      strip: Array(90).fill('none'),
      heartbeat: 'steady',
    };

    db.monitors.unshift(newMonitor);
    db.history[newMonitor.id] = [
      {
        ts: new Date().toISOString(),
        status: 'UP',
        httpCode: newMonitor.expectedStatus,
        latencyMs: 38,
        error: null,
      }
    ];

    saveMockStorage(db);

    setTimeout(() => {
      const liveDb = getMockStorage();
      const target = liveDb.monitors.find(m => m.id === newMonitor.id);
      if (target && target.state === 'PENDING') {
        target.state = 'UP';
        target.lastLatencyMs = 38;
        saveMockStorage(liveDb);
      }
    }, 2500);

    return newMonitor;
  },

  // PUT /api/monitors/:id
  updateMonitor: async (id, monitorData) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch(`/api/monitors/${id}`, { method: 'PUT', body: JSON.stringify(monitorData) });
    }
    await mockDelay();
    const db = getMockStorage();
    const index = db.monitors.findIndex(m => m.id === id);
    if (index === -1) {
      throw new ApiResponseError('Monitor not found.', 404);
    }

    validateMonitorInput(monitorData, db.monitors, id);

    db.monitors[index] = {
      ...db.monitors[index],
      name: monitorData.name.trim(),
      url: monitorData.url.trim(),
      intervalMin: Number(monitorData.intervalMin),
      expectedStatus: Number(monitorData.expectedStatus),
      timeoutSec: Number(monitorData.timeoutSec),
    };

    saveMockStorage(db);
    return db.monitors[index];
  },

  // DELETE /api/monitors/:id
  deleteMonitor: async (id) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch(`/api/monitors/${id}`, { method: 'DELETE' });
    }
    await mockDelay();
    const db = getMockStorage();
    db.monitors = db.monitors.filter(m => m.id !== id);
    delete db.history[id];
    saveMockStorage(db);
    return { ok: true, deletedId: id };
  },

  // POST /api/monitors/:id/pause
  pauseMonitor: async (id) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch(`/api/monitors/${id}/pause`, { method: 'POST' });
    }
    await mockDelay();
    const db = getMockStorage();
    const target = db.monitors.find(m => m.id === id);
    if (!target) throw new ApiResponseError('Monitor not found.', 404);
    target.state = 'PAUSED';
    saveMockStorage(db);
    return target;
  },

  // POST /api/monitors/:id/resume
  resumeMonitor: async (id) => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch(`/api/monitors/${id}/resume`, { method: 'POST' });
    }
    await mockDelay();
    const db = getMockStorage();
    const target = db.monitors.find(m => m.id === id);
    if (!target) throw new ApiResponseError('Monitor not found.', 404);
    target.state = 'UP';
    target.lastCheckedAt = new Date().toISOString();
    saveMockStorage(db);
    return target;
  },

  // GET /api/monitors/:id/history?range=1h|24h|7d -> [{ts,status,httpCode,latencyMs,error}]
  getMonitorHistory: async (id, range = '24h') => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch(`/api/monitors/${id}/history?range=${range}`);
    }
    await mockDelay();
    const db = getMockStorage();
    const historyList = db.history[id] || [];
    const now = Date.now();
    const rangeMs = range === '1h' ? 3600 * 1000 : range === '7d' ? 7 * 86400 * 1000 : 86400 * 1000;

    return historyList.filter(item => (now - new Date(item.ts).getTime()) <= rangeMs);
  },

  // GET /api/incidents?state=open|resolved -> [{id,monitorId,monitorName,startedAt,resolvedAt,state}]
  getIncidents: async (stateFilter) => {
    if (CONFIG.API_MODE === 'real') {
      const q = stateFilter ? `?state=${stateFilter}` : '';
      return realFetch(`/api/incidents${q}`);
    }
    await mockDelay();
    const db = getMockStorage();
    let list = db.incidents || [];
    if (stateFilter === 'open') {
      list = list.filter(i => i.state !== 'RESOLVED');
    } else if (stateFilter === 'resolved') {
      list = list.filter(i => i.state === 'RESOLVED');
    }
    return list;
  },

  // POST /api/reports/export -> {downloadUrl, expiresInSec} (Strictly CSV report link)
  exportReport: async () => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/reports/export', { method: 'POST' });
    }
    await mockDelay();
    const expiry = 900; // 15 mins
    return {
      downloadUrl: `https://pulsewatch-reports-export.s3.ap-south-1.amazonaws.com/reports/incident_audit_${Date.now()}.csv?signature=presigned_s3_token`,
      expiresInSec: expiry,
    };
  },

  // GET /api/system -> {instanceId,az,queueDepth,inFlight,dlq,workers,deps:{rds,ddb,sqs}}
  getSystemStatus: async () => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/system');
    }
    await mockDelay();
    const db = getMockStorage();
    return db.system;
  },

  // GET /api/health -> {ok:true}
  getHealth: async () => {
    if (CONFIG.API_MODE === 'real') {
      return realFetch('/api/health');
    }
    await mockDelay();
    return { ok: true };
  },
};

function validateMonitorInput(data, existingMonitors, currentId = null) {
  if (!data.name || data.name.trim().length === 0) {
    throw new ApiResponseError('Monitor name is required.', 400);
  }
  if (!data.url || data.url.trim().length === 0) {
    throw new ApiResponseError('Endpoint URL is required.', 400);
  }
  if (data.url.length > 2048) {
    throw new ApiResponseError('URL exceeds maximum permitted length of 2048 characters.', 400);
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(data.url);
  } catch (err) {
    throw new ApiResponseError('Invalid URL format. Please include protocol (http:// or https://).', 400);
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new ApiResponseError('Only HTTP and HTTPS protocols are supported.', 400);
  }

  const duplicate = existingMonitors.find(m => m.url.toLowerCase() === data.url.trim().toLowerCase() && m.id !== currentId);
  if (duplicate) {
    throw new ApiResponseError(`A monitor for URL "${data.url}" already exists (${duplicate.name}).`, 409);
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  const hostWithPort = parsedUrl.host.toLowerCase();
  const isWhitelisted = CONFIG.ALLOWED_PRIVATE_HOSTS.some(allowed => allowed.toLowerCase() === hostWithPort || allowed.toLowerCase() === hostname);

  if (!isWhitelisted) {
    if (
      hostname === 'localhost' ||
      hostname.startsWith('127.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname)
    ) {
      throw new ApiResponseError(
        `Target host "${hostname}" is a reserved private IP address. SSRF security policy prohibits monitoring internal endpoints unless whitelisted in CONFIG.ALLOWED_PRIVATE_HOSTS.`,
        403
      );
    }
  }
}

/**
 * Real Backend Fetch Helper with Timeout & Bearer Token
 */
async function realFetch(endpoint, options = {}) {
  const token = authStorage.getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS || 10000);

  const fullUrl = `${CONFIG.API_BASE_URL || ''}${endpoint}`;

  let response;
  try {
    response = await fetch(fullUrl, {
      ...options,
      headers,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      throw new ApiResponseError(`Backend request timed out after ${(CONFIG.REQUEST_TIMEOUT_MS || 10000) / 1000}s. Please check network connectivity.`, 504);
    }
    throw new ApiResponseError(`Network error reaching backend: ${err.message || 'Connection refused'}`, 503);
  } finally {
    clearTimeout(timeoutId);
  }

  if (response.status === 401) {
    authStorage.clearToken();
    window.location.hash = '#/login';
    throw new ApiResponseError('Session expired. Please log in again.', 401);
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiResponseError(data.error || `Server responded with status ${response.status}`, response.status);
  }

  return data;
}
