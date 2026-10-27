/**
 * PulseWatch Global Configuration
 * 
 * Switching to the real backend requires changing ONLY `API_MODE` to 'real'.
 * CloudFront routes /api/* directly to the ALB, so API_BASE_URL defaults to "" (same-origin).
 */
export const CONFIG = {
  // 'mock' | 'real'
  API_MODE: 'mock',
  
  // Real backend base URL (empty string for same-origin CloudFront routing)
  API_BASE_URL: '',

  // Allowed private hosts bypass (for dev/internal tests)
  ALLOWED_PRIVATE_HOSTS: ['127.0.0.1:8080', 'internal.service.local'],

  // Poll intervals
  DASHBOARD_POLL_INTERVAL_MS: 10000,
  SYSTEM_POLL_INTERVAL_MS: 5000,
  MAX_MONITORS_PER_USER: 10,

  // Worker Auto Scaling Group bounds
  WORKER_MIN: 1,
  WORKER_MAX: 3,

  // Real backend request timeout in milliseconds
  REQUEST_TIMEOUT_MS: 10000,
};
