# PulseWatch — High-Precision Uptime & Synthetic Latency Monitor

PulseWatch is an enterprise-grade website and API uptime monitoring platform styled with a calm, high-precision dark aesthetic inspired by Linear and Vercel.

Designed for production deployment to **Amazon Web Services (AWS ap-south-1)** using **S3 + CloudFront**, PulseWatch features a completely decoupled architecture that runs against a realistic browser-side Mock API with persistence and chaos injection, switchable to a real AWS backend by altering a single configuration constant.

---

## Key Features

- **Signature ECG Heartbeat**: SVG animated waveform reflecting real-time state:
  - `UP`: Steady emerald pulse
  - `SUSPECTED`: Pulsing amber arrhythmia (`"Re-checking to confirm..."`)
  - `DOWN`: Crisp red flatline
  - `PAUSED`: Slate dotted line
- **Zero-Dependency SVG Visualizations**:
  - Pure SVG latency area chart with crosshair hover tooltips
  - 90-segment daily reliability strip with tooltips
  - Radial uptime percentage progress ring
  - Micro-sparklines inside stat cards
- **Robust SRE State Machine**:
  - `PENDING -> UP -> SUSPECTED -> DOWN -> UP`.
  - A single failed check *never* triggers DOWN, preventing false alarm fatigue.
- **SSRF Attack Protection**: Built-in validation blocks RFC 1918 private CIDR blocks and AWS metadata endpoints (`169.254.x`) unless whitelisted.
- **Interactive System Reactor Panel**: Monitors serving EC2 API instances, SQS ingress queue depth, dead-letter queues, and dynamic worker nodes that glow and scale out under load.
- **Developer Chaos Control Panel (`Ctrl+Shift+D`)**: Trigger outages, simulate packet loss, test SQS worker scaling, and switch ALB availability zones.
- **Keyboard-Driven Command Palette (`Ctrl+K`)**: Rapidly search monitors, jump across views, and toggle dark/light theme.

---

## Getting Started

### 1. Prerequisites
- Node.js (v18.0.0 or higher recommended)
- npm or pnpm

### 2. Installation
```bash
npm install
```

### 3. Running the Development Server
```bash
npm run dev
```
The application will launch at `http://localhost:5173/`.

### 4. Compiling for Production
```bash
npm run build
```
Generates a static production bundle in `dist/`, fully optimized and self-contained with relative asset linking for direct deployment to Amazon S3.

---

## Switching Between Mock API and Real AWS Backend

PulseWatch is built with a single-source configuration architecture. **Only one file needs to be modified:**

Open `src/config.js`:
```javascript
export const CONFIG = {
  // Change from 'mock' to 'real'
  API_MODE: 'real',

  // Provide your AWS Application Load Balancer endpoint
  API_BASE_URL: 'https://api.yourdomain.com',

  // Allowed private hosts bypass (optional)
  ALLOWED_PRIVATE_HOSTS: ['127.0.0.1:8080'],
  ...
};
```

When `API_MODE` is `'mock'`:
- All requests are resolved in-browser with realistic 80–300ms network jitter.
- State is preserved in `localStorage`.
- Background simulation continuously updates checks and resolves active incidents.

When `API_MODE` is `'real'`:
- All requests dispatch standard HTTP calls with Bearer JWT tokens to the AWS ALB.
- 401 Unauthorized responses automatically redirect to the login screen.

---

## Keyboard Shortcuts

| Shortcut | Description |
| :--- | :--- |
| `Ctrl + K` / `Cmd + K` | Opens the Command Palette to search monitors and jump to routes |
| `Ctrl + Shift + D` | Opens the Chaos Engineering & Dev Control Panel |
| `ESC` | Closes any open modal, dialog, or drawer |

---

## Application Screenshots

> *Below are visual documentation anchors for presentation and viva demonstrations.*

### 1. Telemetry Dashboard (1440px Desktop)
![Dashboard Overview Placeholder](docs/screenshots/dashboard_desktop.png)
*Displays 4 sparkline stat cards, auto-refresh ticker, filter bar, and monitor cards with live ECG heartbeats and 30-day strips.*

### 2. Deep Monitor Inspection & SVG Latency Chart
![Monitor Detail Placeholder](docs/screenshots/monitor_detail.png)
*Detailed response time area chart with crosshair hover tooltips, 90-day strip, and synthetic probe table.*

### 3. Outage & Multi-Probe Confirmation Sequence
![Outage Sequence Placeholder](docs/screenshots/outage_sequence.png)
*Demonstrates the critical state transition: `UP` -> `SUSPECTED` (pulsing amber) -> `DOWN` (flatline) -> `UP` (recovery).*

### 4. System Reactor Panel & Auto-Scaling Worker Fleet
![System Reactor Placeholder](docs/screenshots/system_reactor.png)
*Displays EC2 instance AZ, SQS queue depths, and worker fleet scaling dynamically from 3 to 6 glowing nodes during a load spike.*

### 5. AWS Architecture & Subsystems (About Page)
![Architecture Blueprint Placeholder](docs/screenshots/architecture_blueprint.png)
*Interactive SVG topology mapping CloudFront, ALB, EC2 ASGs, SQS, DynamoDB Streams, and Step Functions.*

### 6. Command Palette (`Ctrl+K`)
![Command Palette Placeholder](docs/screenshots/command_palette.png)
*Fuzzy search across all registered monitors and instant navigation.*

### 7. Mobile Viewport (360px)
![Mobile Experience Placeholder](docs/screenshots/mobile_view.png)
*Sidebar transforms into an ergonomic bottom tab bar with touch-optimized controls.*

### 8. Light Theme Option
![Light Theme Placeholder](docs/screenshots/light_theme.png)
*High-contrast clean daylight palette toggled via user preference and persisted in `localStorage`.*
