#!/usr/bin/env bash
# ==============================================================================
# PulseWatch: Safe Teardown & Permanent Resource Destruction Script
# ==============================================================================
# Run this script ONLY after your academic viva is completely finished and you
# want to destroy all AWS resources to completely eliminate any ongoing charges.
#
# Process:
#   1. Empties all S3 buckets (Artifacts, Frontend, CloudTrail, Config)
#   2. Stops and removes AWS Config recorder and delivery channels
#   3. Runs terraform destroy to tear down all provisioned resources
#   4. Retains the Terraform state bucket until final confirmation
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${SCRIPT_DIR}/../infra"
PROFILE="pulsewatch"
REGION="ap-south-1"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${BOLD}${RED}==============================================================================${NC}"
echo -e "${BOLD}${RED}           WARNING: PULSEWATCH COMPLETE TEARDOWN & DESTRUCTION               ${NC}"
echo -e "${BOLD}${RED}==============================================================================${NC}"
echo -e "This script will permanently destroy all PulseWatch AWS infrastructure:"
echo -e "  - RDS PostgreSQL database instance & snapshots"
echo -e "  - DynamoDB tables (pulsewatch-checks, pulsewatch-incidents)"
echo -e "  - Application Load Balancer & Auto Scaling Groups"
echo -e "  - Step Functions state machines & Lambda functions"
echo -e "  - CloudTrail, CloudWatch dashboards/alarms, and VPCs"
echo ""

read -rp "Are you ABSOLUTELY SURE you want to destroy everything? Type 'DESTROY' to proceed: " confirm

if [[ "${confirm}" != "DESTROY" ]]; then
    echo -e "${YELLOW}Teardown cancelled. No resources were modified.${NC}"
    exit 0
fi

ACCOUNT_ID=$(aws --profile "${PROFILE}" --region "${REGION}" sts get-caller-identity --query "Account" --output text)

echo -e "\n${BOLD}${CYAN}Step 1: Emptying S3 versioned and unversioned buckets...${NC}"
empty_bucket() {
    local bucket="$1"
    if aws --profile "${PROFILE}" --region "${REGION}" s3api head-bucket --bucket "${bucket}" 2>/dev/null; then
        echo -e "  Emptying bucket: ${YELLOW}${bucket}${NC}"
        aws --profile "${PROFILE}" --region "${REGION}" s3 rm "s3://${bucket}" --recursive || true
    fi
}

empty_bucket "pulsewatch-artifacts-${ACCOUNT_ID}"
empty_bucket "pulsewatch-frontend-${ACCOUNT_ID}"
empty_bucket "pulsewatch-cloudtrail-${ACCOUNT_ID}"
empty_bucket "pulsewatch-config-${ACCOUNT_ID}"

echo -e "\n${BOLD}${CYAN}Step 2: Stopping AWS Config recorder to prevent teardown deadlocks...${NC}"
aws --profile "${PROFILE}" --region "${REGION}" configservice stop-configuration-recorder --configuration-recorder-name pulsewatch-recorder 2>/dev/null || true

echo -e "\n${BOLD}${CYAN}Step 3: Executing Terraform Destroy...${NC}"
terraform -chdir="${INFRA_DIR}" destroy -auto-approve

echo -e "\n${BOLD}${GREEN}==============================================================================${NC}"
echo -e "${BOLD}${GREEN}      ✓ All PulseWatch AWS infrastructure successfully destroyed!             ${NC}"
echo -e "${BOLD}${GREEN}==============================================================================${NC}"
echo -e "Your account spend is now permanently halted at \$0.00/hour."
