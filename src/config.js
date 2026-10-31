/**
 * PulseWatch Global Configuration
 * 
 * Switching to the real backend requires setting `API_MODE` to 'real'
 * and providing your Application Load Balancer endpoint in `API_BASE_URL`.
 * (Automated by ./scripts/deploy-frontend.sh during production deployment)
 */
export const CONFIG = {
  // 'mock' | 'real'
  API_MODE: 'mock',
  
  // Real backend base URL (empty string for same-origin CloudFront, or ALB URL)
  API_BASE_URL: '',

  // Allowed private hosts bypass (for dev/internal tests)
  ALLOWED_PRIVATE_HOSTS: ['10.1.1.111', '127.0.0.1:8080'],

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
