# PulseWatch System Architecture & Codebase Guide

This document provides a component-by-component architectural walk-through of the PulseWatch frontend. It serves as an authoritative viva and technical review reference, explaining what each core file accomplishes, its design rationale, and how it connects to the broader distributed monitoring workflow.

---

## 1. Project Configuration & Scaffolding

### `src/config.js`
- **Purpose**: Defines global application environment constants, most notably `API_MODE` (`'mock'` or `'real'`), `API_BASE_URL`, poll frequencies, and private network CIDRs permitted for testing.
- **Viva Key Point**: To deploy against a real AWS Application Load Balancer and RDS/DynamoDB backend, this is the **only file requiring modification**. No page, component, or state logic has any knowledge of the transport mechanism.

### `vite.config.js`
- **Purpose**: Bundler configuration specifying the React plugin and `base: './'`.
- **Viva Key Point**: Setting relative asset paths guarantees that the static distribution directory (`dist/`) can be hosted directly on Amazon S3 + CloudFront without requiring server-side URL rewrite rules.

---

## 2. API Transport & Simulation Layer

### `src/api/client.js`
- **Purpose**: The unified HTTP abstraction layer. Exposes asynchronous methods (`getSummary`, `getMonitors`, `createMonitor`, `pauseMonitor`, `getMonitorHistory`, `getIncidents`, `getSystemStatus`, etc.).
- **Operation**:
  - When `CONFIG.API_MODE === 'mock'`, requests are handled by the browser-side mock engine, applying a simulated network delay of 80–300ms.
  - When `CONFIG.API_MODE === 'real'`, dispatches native browser `fetch()` calls to `CONFIG.API_BASE_URL` with bearer token authorization from `sessionStorage`.
  - Enforces SSRF protection: strictly blocks RFC 1918 private IP blocks (10.x, 172.16-31.x, 192.168.x, 127.x, 169.254.x) from being registered unless explicitly listed in `ALLOWED_PRIVATE_HOSTS`.

### `src/mock/storage.js`
- **Purpose**: Manages mock state persistence using browser `localStorage` (`pulsewatch_mock_db_v1`).
- **Operation**: Seeds 6 realistic production monitors (spanning auth gateways, WebSocket endpoints, and CDN edge caches), 30 days of synthetic probe telemetry, 3 historical incident logs, and initial worker fleet metrics.

### `src/mock/engine.js`
- **Purpose**: The background simulation and chaos control engine. Runs an automated tick loop every 4 seconds.
- **Key Reliability Architecture**:
  - Implements the state machine: `PENDING -> UP -> SUSPECTED -> DOWN -> UP`.
  - **Enforces the critical SRE principle**: A single probe failure *never* declares `DOWN`. The system first transitions to `SUSPECTED` (pulsing amber indicator, `"Re-checking to confirm..."`), requiring multi-probe failure before confirming an outage.
  - Exposes Dev Chaos actions (invoked via `Ctrl+Shift+D`): Force Down, Force Recover, SQS Load Test (auto-scaling workers from 3 to 6 nodes), ALB Instance Switch, and DynamoDB health toggling.

---

## 3. Global State & App Shell

### `src/context/AppContext.jsx`
- **Purpose**: React Context provider managing global application state:
  - Theme switching (persisting `'dark'` or `'light'` mode via `data-theme` attribute).
  - Session tokens and authenticated user metadata (stored in `sessionStorage`).
  - Active toast notifications.
  - Global modal visibility for the Command Palette (`Ctrl+K`) and Dev Chaos Panel (`Ctrl+Shift+D`).
  - Network reachability state: displays a non-intrusive banner if backend pings fail while preserving cached telemetry.

### `src/components/AppLayout.jsx`
- **Purpose**: The responsive shell wrapping all protected views.
- **Design Behavior**:
  - On desktop (>= 768px): fixed high-density navigation sidebar with status accents, quick shortcut pills, and user avatar.
  - On mobile (< 768px): transitions seamlessly into an ergonomic bottom tab bar.
  - Top bar houses the real-time `EventTicker`, active region badge (`ap-south-1`), and quick profile actions.

---

## 4. Signature Data Visualization Components

### `src/components/HeartbeatLine.jsx`
- **Purpose**: The signature ECG waveform visualizer for individual monitors.
- **States**:
  - `steady`: Emerald stroke with smooth linear CSS dash offset animation.
  - `irregular` / `SUSPECTED`: Amber stroke with rapid, heightened cardiac arrhythmia waveform.
  - `flat` / `DOWN`: Crimson flatline representing zero ingress telemetry.
  - `paused`: Slate dotted line indicating inactive worker rotation.

### `src/components/LatencyAreaChart.jsx`
- **Purpose**: Custom pure SVG area chart for rendering response time history across 1h, 24h, and 7d horizons.
- **Viva Key Point**: Built with **zero third-party chart libraries**, keeping the bundle lean and ensuring pixel-perfect fidelity with Linear/Vercel dark themes. Features an interactive hover crosshair with dynamic tooltip rendering.

### `src/components/UptimeStrip.jsx`
- **Purpose**: High-density 90-segment daily reliability breakdown strip.
- **Behavior**: Each segment corresponds to a 24-hour observation window. Hovering over a segment presents a tooltip detailing the exact date offset and operational status.

### `src/components/RadialUptimeRing.jsx`
- **Purpose**: Circular SVG progress gauge displaying the 24-hour availability ratio (e.g., 99.98%) with animated stroke-dashoffset transitions.

### `src/components/Sparkline.jsx`
- **Purpose**: Compact SVG inline trendline embedded directly inside dashboard summary cards to display latency and uptime trajectory without visual clutter.

---

## 5. Pages & View Layer

### `src/pages/LoginPage.jsx`
- **Purpose**: Authentication entry point. Centered glassmorphic card with inline validation and seamless toggling between sign-in and account registration.

### `src/pages/DashboardPage.jsx`
- **Purpose**: Primary operational cockpit.
- **Features**:
  - 4 core metric stat cards (Monitors Up, Outages/Down, Global 24h Uptime, Average Latency) with embedded SVG sparklines.
  - Active incident notification banner triggered immediately if any target is confirmed `DOWN` or `SUSPECTED`.
  - Filterable monitor cards featuring live ECG lines, 30-day mini strips, and latency metrics.
  - 10-second background polling cycle with pause toggle and `"Updated Xs ago"` indicator.

### `src/pages/MonitorDetailPage.jsx`
- **Purpose**: Deep telemetry view for an individual target.
- **Features**:
  - Radial uptime ring, configuration headers, and quick lifecycle actions (Pause, Resume, Edit, Delete).
  - SVG Latency area chart with time range switching (1h, 24h, 7d).
  - Full 90-bar daily reliability strip with interactive tooltips.
  - Tabular log of recent synthetic probes and associated incident audit trail.
  - Defensive fallback: displays `"History unavailable"` if timeseries telemetry fails, while preserving live status and controls.

### `src/pages/IncidentsPage.jsx`
- **Purpose**: Audit ledger of all historical and active downtime events. Supports filtering by state (All, Open, Resolved) and generating signed report export URLs via the API.

### `src/pages/SystemPage.jsx`
- **Purpose**: The "Reactor Panel" presenting live cloud infrastructure health.
- **Features**:
  - Visualizes active EC2 instance ID and Availability Zone served by the ALB.
  - Live SQS queue depth, in-flight checks, and DLQ poison message counter.
  - Dynamic worker fleet visualization: glowing worker nodes that visually scale out (3 -> 6 nodes) during load testing simulations.
  - Health status dots for Amazon RDS PostgreSQL, Amazon DynamoDB, and Amazon SQS.

### `src/pages/AboutPage.jsx`
- **Purpose**: Interactive educational reference detailing the production AWS ap-south-1 architecture.
- **Features**:
  - Custom SVG topology diagram illustrating the flow between CloudFront, ALB, EC2 API ASG, SQS, Worker ASG, DynamoDB Streams, Step Functions, SNS, and RDS.
  - Interactive selection pane detailing the specific operational role and security model of each AWS service.

---

## 6. Styling & Design Tokens

### `src/styles/tokens.css`
- Contains all design tokens: CSS variables for `#0a0b0f` background, layered `#101218` and `#151821` dark surfaces, 1px subtle borders, status glows, Inter and JetBrains Mono font declarations, and light theme overrides.
- Implements strict `prefers-reduced-motion` compliance to respect user accessibility preferences.
