# PulseWatch API Specification & Contract

The production AWS backend (ALB + EC2/ECS/Lambda) must conform exactly to this REST specification. The built-in client (`src/api/client.js`) and mock engine (`src/mock/engine.js`) adhere 100% to this contract.

---

## 1. Authentication

### `POST /api/auth/register`
Creates a new SRE operator account.

**Request Body:**
```json
{
  "email": "operator@pulsewatch.internal",
  "password": "securepassword123"
}
```

**Response (200 OK):**
```json
{
  "token": "jwt_header.payload.signature",
  "user": {
    "id": "usr_99a8b1",
    "email": "operator@pulsewatch.internal",
    "name": "operator",
    "role": "Engineer"
  }
}
```

---

### `POST /api/auth/login`
Authenticates existing credentials.

**Request Body:**
```json
{
  "email": "operator@pulsewatch.internal",
  "password": "securepassword123"
}
```

**Response (200 OK):**
```json
{
  "token": "jwt_header.payload.signature",
  "user": {
    "id": "usr_dev_01",
    "email": "operator@pulsewatch.internal",
    "name": "Lead SRE",
    "role": "Admin"
  }
}
```

---

## 2. Telemetry Summary

### `GET /api/summary`
Returns global uptime, latency, and monitor counts for the authenticated user.

**Response (200 OK):**
```json
{
  "up": 5,
  "down": 0,
  "suspected": 0,
  "paused": 1,
  "uptime24h": 99.92,
  "avgLatency24h": 46,
  "spark": [44, 46, 42, 48, 45, 49, 52, 47, 46, 46]
}
```

---

## 3. Monitors Management

### `GET /api/monitors`
Lists all monitors configured for the user.

**Response (200 OK):**
```json
[
  {
    "id": "mon-001",
    "name": "Production Auth Gateway",
    "url": "https://auth.pulsewatch.dev/v1/health",
    "intervalMin": 1,
    "expectedStatus": 200,
    "timeoutSec": 5,
    "state": "UP",
    "lastCheckedAt": "2026-10-27T06:30:00.000Z",
    "lastLatencyMs": 42,
    "uptime24h": 99.98,
    "strip": ["up", "up", "up", "down", "up"],
    "heartbeat": "steady"
  }
]
```

---

### `POST /api/monitors`
Registers a new endpoint monitor.

**Request Body:**
```json
{
  "name": "Payment Webhook Edge",
  "url": "https://pay.pulsewatch.dev/health",
  "intervalMin": 5,
  "expectedStatus": 200,
  "timeoutSec": 10
}
```

**Response (201 Created):**
```json
{
  "id": "mon-7821",
  "name": "Payment Webhook Edge",
  "url": "https://pay.pulsewatch.dev/health",
  "intervalMin": 5,
  "expectedStatus": 200,
  "timeoutSec": 10,
  "state": "PENDING",
  "lastCheckedAt": "2026-10-27T06:35:00.000Z",
  "lastLatencyMs": 0,
  "uptime24h": 100.0,
  "strip": ["up", "up"],
  "heartbeat": "steady"
}
```

---

### `PUT /api/monitors/:id`
Updates monitor configuration.

**Request Body:**
```json
{
  "name": "Payment Webhook Edge (Primary)",
  "url": "https://pay.pulsewatch.dev/health",
  "intervalMin": 1,
  "expectedStatus": 200,
  "timeoutSec": 5
}
```

---

### `DELETE /api/monitors/:id`
Deletes a monitor and purges timeseries data.

**Response (200 OK):**
```json
{
  "ok": true,
  "deletedId": "mon-7821"
}
```

---

### `POST /api/monitors/:id/pause` & `POST /api/monitors/:id/resume`
Suspends or resumes polling for a monitor.

**Response (200 OK):**
```json
{
  "id": "mon-001",
  "state": "PAUSED"
}
```

---

### `GET /api/monitors/:id/history?range=1h|24h|7d`
Returns synthetic check data points within the specified time range.

**Response (200 OK):**
```json
[
  {
    "ts": "2026-10-27T06:20:00.000Z",
    "status": "UP",
    "httpCode": 200,
    "latencyMs": 42,
    "error": null
  },
  {
    "ts": "2026-10-27T06:25:00.000Z",
    "status": "UP",
    "httpCode": 200,
    "latencyMs": 44,
    "error": null
  }
]
```

---

## 4. Incidents & Reports

### `GET /api/incidents?state=open|resolved`
Lists detected incidents.

**Response (200 OK):**
```json
[
  {
    "id": "inc-101",
    "monitorId": "mon-002",
    "monitorName": "Primary API Cluster (EKS)",
    "startedAt": "2026-10-23T11:42:00.000Z",
    "resolvedAt": "2026-10-23T11:50:14.000Z",
    "state": "RESOLVED",
    "durationStr": "8m 14s",
    "rootCause": "Connection pool saturation on RDS Read Replica."
  }
]
```

---

### `POST /api/reports/export`
Generates a pre-signed S3 download URL for an incident audit report.

**Response (200 OK):**
```json
{
  "downloadUrl": "https://pulsewatch-reports.s3.ap-south-1.amazonaws.com/incident_summary.pdf?AWSAccessKeyId=...",
  "expiresInSec": 900,
  "generatedAt": "2026-10-27T06:36:00.000Z"
}
```

---

## 5. System Health & Observability

### `GET /api/system`
Returns distributed fleet telemetry for the Reactor Panel.

**Response (200 OK):**
```json
{
  "instanceId": "i-09ab7f4122dca8f10",
  "az": "ap-south-1a",
  "queueDepth": 4,
  "inFlight": 6,
  "dlq": 0,
  "workers": [
    { "id": "wrk-01", "az": "ap-south-1a", "status": "HEALTHY", "activeChecks": 2, "cpuPercent": 24, "lastHeartbeatSec": 2 },
    { "id": "wrk-02", "az": "ap-south-1b", "status": "HEALTHY", "activeChecks": 3, "cpuPercent": 31, "lastHeartbeatSec": 1 },
    { "id": "wrk-03", "az": "ap-south-1c", "status": "HEALTHY", "activeChecks": 1, "cpuPercent": 19, "lastHeartbeatSec": 3 }
  ],
  "deps": {
    "rds": "HEALTHY",
    "ddb": "HEALTHY",
    "sqs": "HEALTHY"
  }
}
```

### `GET /api/health`
Health check probe endpoint.
**Response (200 OK):** `{"ok": true}`
