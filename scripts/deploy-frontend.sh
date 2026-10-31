#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

BUCKET="$(terraform -chdir="$DIR/infra" output -raw frontend_bucket_name 2>/dev/null || true)"
ALB_DNS="$(terraform -chdir="$DIR/infra" output -raw alb_dns_name 2>/dev/null || true)"

if [ -z "$BUCKET" ]; then
  echo "[PulseWatch ERROR] Frontend bucket output not available."
  exit 1
fi

echo "[PulseWatch] Preparing frontend build pointing to ALB endpoint (http://$ALB_DNS)..."
cd "$DIR"

# Point API_BASE_URL to real ALB
cat << CONFIG_EOF > src/config.js
export const CONFIG = {
  API_MODE: 'real',
  API_BASE_URL: 'http://$ALB_DNS',
  ALLOWED_PRIVATE_HOSTS: ['10.1.1.111'],
  DASHBOARD_POLL_INTERVAL_MS: 10000,
  SYSTEM_POLL_INTERVAL_MS: 5000,
  MAX_MONITORS_PER_USER: 10,
  WORKER_MIN: 1,
  WORKER_MAX: 3,
  REQUEST_TIMEOUT_MS: 10000,
};
CONFIG_EOF

npm run build

echo "[PulseWatch] Syncing compiled dist/ to s3://$BUCKET ..."
aws s3 sync dist/ "s3://$BUCKET/" --delete --profile pulsewatch --region ap-south-1

echo "[PulseWatch] Frontend successfully deployed to http://pulsewatch-frontend-826903518995.s3-website.ap-south-1.amazonaws.com"
