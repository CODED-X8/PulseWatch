/**
 * PulseWatch Simulation & Background Engine
 * Enforces worker scaling bounds: 1 -> 3 (WORKER_MAX configurable).
 */

import { getMockStorage, saveMockStorage } from './storage';
import { CONFIG } from '../config';

let engineInterval = null;

export function startMockSimulationEngine() {
  if (engineInterval) return;

  engineInterval = setInterval(() => {
    tickSimulation();
  }, 4000);
}

export function stopMockSimulationEngine() {
  if (engineInterval) {
    clearInterval(engineInterval);
    engineInterval = null;
  }
}

function tickSimulation() {
  const db = getMockStorage();
  const now = Date.now();
  let changed = false;

  // 1. Process Monitors
  db.monitors.forEach(mon => {
    if (mon.state === 'PAUSED') return;

    const isForcedDown = db.forcedDownIds && db.forcedDownIds.includes(mon.id);

    if (isForcedDown) {
      if (mon.state === 'UP' || mon.state === 'PENDING') {
        mon.state = 'SUSPECTED';
        mon.heartbeat = 'irregular';
        mon.lastCheckedAt = new Date(now).toISOString();
        mon.lastLatencyMs = 2840;
        mon._consecutiveFailures = 1;
        changed = true;
      } else if (mon.state === 'SUSPECTED') {
        mon._consecutiveFailures = (mon._consecutiveFailures || 1) + 1;
        if (mon._consecutiveFailures >= 2) {
          mon.state = 'DOWN';
          mon.heartbeat = 'flat';
          mon.lastCheckedAt = new Date(now).toISOString();
          mon.lastLatencyMs = 0;
          mon.strip.shift();
          mon.strip.push('down');

          const hasOpen = db.incidents.find(inc => inc.monitorId === mon.id && (inc.state === 'OPEN' || inc.state === 'CONFIRMED' || inc.state === 'SUSPECTED'));
          if (!hasOpen) {
            db.incidents.unshift({
              id: `inc-${Date.now().toString().slice(-4)}`,
              monitorId: mon.id,
              monitorName: mon.name,
              startedAt: new Date(now).toISOString(),
              resolvedAt: null,
              state: 'CONFIRMED',
              rootCause: 'Connection reset by peer / Gateway timed out.',
            });
          }

          if (db.history[mon.id]) {
            db.history[mon.id].push({
              ts: new Date(now).toISOString(),
              status: 'DOWN',
              httpCode: 504,
              latencyMs: 0,
              error: 'Gateway Timeout (504)',
            });
          }
          changed = true;
        }
      }
      return;
    }

    if (mon.state === 'DOWN' || mon.state === 'SUSPECTED') {
      mon.state = 'UP';
      mon.heartbeat = 'steady';
      mon._consecutiveFailures = 0;
      mon.lastCheckedAt = new Date(now).toISOString();
      mon.lastLatencyMs = Math.floor(25 + Math.random() * 40);
      mon.strip.shift();
      mon.strip.push('up');
      
      db.incidents.forEach(inc => {
        if (inc.monitorId === mon.id && inc.state !== 'RESOLVED') {
          inc.state = 'RESOLVED';
          inc.resolvedAt = new Date(now).toISOString();
        }
      });
      changed = true;
    } else {
      const jitter = Math.floor(Math.random() * 12 - 6);
      const base = mon.id === 'mon-005' ? 18 : mon.id === 'mon-004' ? 32 : 55;
      mon.lastLatencyMs = Math.max(12, base + jitter);
      mon.lastCheckedAt = new Date(now).toISOString();
      
      if (Math.random() > 0.85) {
        mon.strip.shift();
        mon.strip.push('up');
      }

      if (db.history && db.history[mon.id] && Math.random() > 0.6) {
        db.history[mon.id].push({
          ts: new Date(now).toISOString(),
          status: 'UP',
          httpCode: 200,
          latencyMs: mon.lastLatencyMs,
          error: null,
        });
        if (db.history[mon.id].length > 200) {
          db.history[mon.id].shift();
        }
      }
      changed = true;
    }
  });

  // 2. Load test decay / Worker fleet scaling simulation (1 -> max configured in CONFIG.WORKER_MAX)
  if (db.system) {
    if (db.system.loadTestActive) {
      if (db.system.queueDepth > 5) {
        db.system.queueDepth = Math.max(4, db.system.queueDepth - 12);
        db.system.inFlight = Math.max(2, db.system.inFlight - 6);
        if (db.system.queueDepth <= 5) {
          db.system.loadTestActive = false;
          // Scale back workers to baseline (min 1)
          db.system.workers = db.system.workers.slice(0, CONFIG.WORKER_MIN || 1);
          changed = true;
        }
      }
    }
  }

  if (changed) {
    saveMockStorage(db);
  }
}

// Dev Panel Actions
export const devPanel = {
  forceDown: (monitorId) => {
    const db = getMockStorage();
    if (!db.forcedDownIds) db.forcedDownIds = [];
    if (!db.forcedDownIds.includes(monitorId)) {
      db.forcedDownIds.push(monitorId);
      const mon = db.monitors.find(m => m.id === monitorId);
      if (mon && mon.state === 'UP') {
        mon.state = 'SUSPECTED';
        mon.heartbeat = 'irregular';
        mon._consecutiveFailures = 1;
        mon.lastCheckedAt = new Date().toISOString();
      }
      saveMockStorage(db);
    }
  },

  forceRecover: (monitorId) => {
    const db = getMockStorage();
    if (db.forcedDownIds) {
      db.forcedDownIds = db.forcedDownIds.filter(id => id !== monitorId);
    }
    const mon = db.monitors.find(m => m.id === monitorId);
    if (mon) {
      mon.state = 'UP';
      mon.heartbeat = 'steady';
      mon._consecutiveFailures = 0;
      mon.lastCheckedAt = new Date().toISOString();
      mon.lastLatencyMs = 45;
    }
    const now = Date.now();
    db.incidents.forEach(inc => {
      if (inc.monitorId === monitorId && inc.state !== 'RESOLVED') {
        inc.state = 'RESOLVED';
        inc.resolvedAt = new Date(now).toISOString();
      }
    });
    saveMockStorage(db);
  },

  triggerLoadTest: () => {
    const db = getMockStorage();
    if (!db.system) return;
    db.system.loadTestActive = true;
    db.system.queueDepth = 320;
    db.system.inFlight = 48;
    
    // Scale out workers up to CONFIG.WORKER_MAX (default 3)
    const workerPool = [
      { id: 'wrk-01', az: 'ap-south-1a', status: 'HEALTHY', activeChecks: 14, cpuPercent: 82, lastHeartbeatSec: 1 },
      { id: 'wrk-02', az: 'ap-south-1b', status: 'SCALED_OUT', activeChecks: 16, cpuPercent: 78, lastHeartbeatSec: 1 },
      { id: 'wrk-03', az: 'ap-south-1c', status: 'SCALED_OUT', activeChecks: 12, cpuPercent: 71, lastHeartbeatSec: 2 },
    ];
    db.system.workers = workerPool.slice(0, CONFIG.WORKER_MAX || 3);
    saveMockStorage(db);
  },

  switchApiInstance: () => {
    const db = getMockStorage();
    if (!db.system) return;
    const azs = ['ap-south-1a', 'ap-south-1b', 'ap-south-1c'];
    const randAz = azs[Math.floor(Math.random() * azs.length)];
    const hex = Math.random().toString(16).substring(2, 10);
    db.system.instanceId = `i-0${hex}`;
    db.system.az = randAz;
    saveMockStorage(db);
  },

  toggleDynamoDbFailure: () => {
    const db = getMockStorage();
    if (!db.system) return;
    db.system.deps.ddb = db.system.deps.ddb === 'HEALTHY' ? 'DEGRADED' : 'HEALTHY';
    saveMockStorage(db);
  },

  resetAll: () => {
    localStorage.removeItem('pulsewatch_mock_db_v1');
    getMockStorage();
  }
};
