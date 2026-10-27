/**
 * 20-line Node.js Stub Server for verifying Real Backend Mode
 * Run: node stub-server.js
 * Then in src/config.js: API_MODE: 'real', API_BASE_URL: 'http://localhost:4000'
 */
import http from 'http';

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');

  if (req.method === 'OPTIONS') return res.writeHead(204).end();

  res.setHeader('Content-Type', 'application/json');

  if (req.url === '/api/health') {
    return res.end(JSON.stringify({ ok: true }));
  }

  if (req.url === '/api/summary') {
    return res.end(JSON.stringify({
      up: 6, down: 0, suspected: 0, paused: 0,
      uptime24h: 100.0, avgLatency24h: 38,
      spark: [35, 36, 40, 39, 38, 37, 38, 39, 38, 38]
    }));
  }

  res.writeHead(404).end(JSON.stringify({ error: 'Endpoint not implemented in stub' }));
});

server.listen(4000, () => console.log('PulseWatch Stub Server running on http://localhost:4000'));
