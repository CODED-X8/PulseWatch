/**
 * PulseWatch Global Configuration
 * 
 * Switching to the real backend requires changing ONLY `API_MODE` to 'real'
 * and providing `API_BASE_URL` (e.g. your AWS Application Load Balancer endpoint).
 */
export const CONFIG = {
  // 'mock' | 'real'
  API_MODE: 'mock',
  
  // Real backend base URL (used when API_MODE === 'real')
  API_BASE_URL: 'https://api.pulsewatch.internal',

  // Allowed private hosts bypass (for dev/internal tests)
  ALLOWED_PRIVATE_HOSTS: ['127.0.0.1:8080', 'internal.service.local'],

  // Poll intervals
  DASHBOARD_POLL_INTERVAL_MS: 10000,
  SYSTEM_POLL_INTERVAL_MS: 5000,
  MAX_MONITORS_PER_USER: 10,
};
