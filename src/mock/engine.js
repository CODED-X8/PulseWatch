/**
 * PulseWatch Simulation & Background Engine
 * Handles:
 *  - Background check loop with realistic latency jitter
 *  - State machine: PENDING -> UP -> SUSPECTED (amber pulsing) -> DOWN -> UP
 *  - Single failed check NEVER triggers DOWN directly (must go through SUSPECTED)
 *  - Dev Panel simulations: Force DOWN, Recover, Scale Workers / Load Test, Instance switch, DDB failure
 */

import { getMockStorage, saveMockStorage } from './storage';

let engineInterval = null;

export function startMockSimulationEngine() {
  if (engineInterval) return;

  engineInterval = setInterval(() => {
    tickSimulation();
  }, 4000); // Ticks every 4 seconds
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

    // Is this monitor forced DOWN by Dev Panel?
    const isForcedDown = db.forcedDownIds && db.forcedDownIds.includes(mon.id);

    if (isForcedDown) {
      if (mon.state === 'UP' || mon.state === 'PENDING') {
        // Move to SUSPECTED first
        mon.state = 'SUSPECTED';
        mon.heartbeat = 'irregular';
        mon.lastCheckedAt = new Date(now).toISOString();
        mon.lastLatencyMs = 2840;
        mon.consecutiveFailures = 1;
        changed = true;
      } else if (mon.state === 'SUSPECTED') {
        // Check if it has been suspected long enough or on subsequent failure
        mon.consecutiveFailures = (mon.consecutiveFailures || 1) + 1;
        if (mon.consecutiveFailures >= 2) {
          mon.state = 'DOWN';
          mon.heartbeat = 'flat';
          mon.lastCheckedAt = new Date(now).toISOString();
          mon.lastLatencyMs = 0;
          // Append to strip
          mon.strip.shift();
          mon.strip.push('down');
          // Open incident if not already open
          const hasOpen = db.incidents.find(inc => inc.monitorId === mon.id && (inc.state === 'OPEN' || inc.state === 'CONFIRMED' || inc.state === 'SUSPECTED'));
          if (!hasOpen) {
            db.incidents.unshift({
              id: `inc-${Date.now().toString().slice(-4)}`,
              monitorId: mon.id,
              monitorName: mon.name,
              startedAt: new Date(now).toISOString(),
              resolvedAt: null,
              state: 'CONFIRMED',
              durationStr: 'In progress',
              rootCause: 'Connection reset by peer / Gateway timed out.',
            });
          }
          // Append failure to history
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

    // Normal healthy routine (with rare benign jitter)
    if (mon.state === 'DOWN' || mon.state === 'SUSPECTED') {
      // If was down or suspected and not forced down, recover
      mon.state = 'UP';
      mon.heartbeat = 'steady';
      mon.consecutiveFailures = 0;
      mon.lastCheckedAt = new Date(now).toISOString();
      mon.lastLatencyMs = Math.floor(25 + Math.random() * 40);
      mon.strip.shift();
      mon.strip.push('up');
      
      // Resolve any active incidents
      db.incidents.forEach(inc => {
        if (inc.monitorId === mon.id && inc.state !== 'RESOLVED') {
          inc.state = 'RESOLVED';
          inc.resolvedAt = new Date(now).toISOString();
          const startMs = new Date(inc.startedAt).getTime();
          const diffSec = Math.floor((now - startMs) / 1000);
          inc.durationStr = `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
        }
      });
      changed = true;
    } else {
      // Monitor is UP: apply gentle jitter
      const jitter = Math.floor(Math.random() * 12 - 6);
      const base = mon.id === 'mon-005' ? 18 : mon.id === 'mon-004' ? 32 : 55;
      mon.lastLatencyMs = Math.max(12, base + jitter);
      mon.lastCheckedAt = new Date(now).toISOString();
      
      // Keep strip fresh periodically
      if (Math.random() > 0.85) {
        mon.strip.shift();
        mon.strip.push('up');
      }

      // Add check point to history occasionally
      if (db.history && db.history[mon.id] && Math.random() > 0.6) {
        db.history[mon.id].push({
          ts: new Date(now).toISOString(),
          status: 'UP',
          httpCode: 200,
          latencyMs: mon.lastLatencyMs,
          error: null,
        });
        // Keep max 200 history items in memory
        if (db.history[mon.id].length > 200) {
          db.history[mon.id].shift();
        }
      }
      changed = true;
    }
  });

  // 2. Load test decay / Worker fleet scaling simulation
  if (db.system) {
    if (db.system.loadTestActive) {
      if (db.system.queueDepth > 10) {
        // Drain slowly
        db.system.queueDepth = Math.max(4, db.system.queueDepth - 15);
        db.system.inFlight = Math.max(5, db.system.inFlight - 8);
        if (db.system.queueDepth <= 10) {
          db.system.loadTestActive = false;
          // Scale back workers to 3
          db.system.workers = db.system.workers.slice(0, 3);
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
      // Immediately set monitor to SUSPECTED to show state flow
      const mon = db.monitors.find(m => m.id === monitorId);
      if (mon && mon.state === 'UP') {
        mon.state = 'SUSPECTED';
        mon.heartbeat = 'irregular';
        mon.consecutiveFailures = 1;
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
      mon.consecutiveFailures = 0;
      mon.lastCheckedAt = new Date().toISOString();
      mon.lastLatencyMs = 45;
    }
    // Resolve incidents for this monitor
    const now = Date.now();
    db.incidents.forEach(inc => {
      if (inc.monitorId === monitorId && inc.state !== 'RESOLVED') {
        inc.state = 'RESOLVED';
        inc.resolvedAt = new Date(now).toISOString();
        const startMs = new Date(inc.startedAt).getTime();
        const diffSec = Math.floor((now - startMs) / 1000);
        inc.durationStr = `${Math.floor(diffSec / 60)}m ${diffSec % 60}s`;
      }
    });
    saveMockStorage(db);
  },

  triggerLoadTest: () => {
    const db = getMockStorage();
    if (!db.system) return;
    db.system.loadTestActive = true;
    db.system.queueDepth = 480;
    db.system.inFlight = 92;
    // Auto-scale workers from 3 to 6
    db.system.workers = [
      { id: 'wrk-01', az: 'ap-south-1a', status: 'HEALTHY', activeChecks: 18, cpuPercent: 82, lastHeartbeatSec: 1 },
      { id: 'wrk-02', az: 'ap-south-1b', status: 'HEALTHY', activeChecks: 19, cpuPercent: 88, lastHeartbeatSec: 1 },
      { id: 'wrk-03', az: 'ap-south-1c', status: 'HEALTHY', activeChecks: 17, cpuPercent: 79, lastHeartbeatSec: 2 },
      { id: 'wrk-04', az: 'ap-south-1a', status: 'SCALED_OUT', activeChecks: 16, cpuPercent: 74, lastHeartbeatSec: 1 },
      { id: 'wrk-05', az: 'ap-south-1b', status: 'SCALED_OUT', activeChecks: 12, cpuPercent: 68, lastHeartbeatSec: 2 },
      { id: 'wrk-06', az: 'ap-south-1c', status: 'SCALED_OUT', activeChecks: 10, cpuPercent: 59, lastHeartbeatSec: 1 },
    ];
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
    getMockStorage(); // Will reseed fresh
  }
};
