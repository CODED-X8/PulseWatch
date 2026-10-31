#!/usr/bin/env bash
# ==============================================================================
# PulseWatch: Dynamic Operator IP Restrictor
# ==============================================================================
# Automatically detects the current public egress IPv4 address of the operator's
# machine (e.g. at the university venue or home) and updates Terraform's
# `my_ip_cidr` variable, locking the ALB ingress strictly to that IP (/32).
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="${SCRIPT_DIR}/../infra"

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
NC="\033[0m"

echo -e "${BOLD}${CYAN}=== PulseWatch Dynamic Operator IP Restrictor ===${NC}"

# Detect current public IP
echo -e "Detecting current public IP via checkip.amazonaws.com..."
DETECTED_IP=$(curl -s --max-time 5 https://checkip.amazonaws.com | tr -d '[:space:]')

if [[ -z "${DETECTED_IP}" ]]; then
    DETECTED_IP=$(curl -s --max-time 5 https://ifconfig.me | tr -d '[:space:]')
fi

if [[ -z "${DETECTED_IP}" ]]; then
    echo -e "${YELLOW}Could not automatically determine public IP. Please specify manually:${NC}"
    read -rp "Enter your IP or CIDR (e.g. 203.0.113.4): " DETECTED_IP
fi

# Ensure /32 if single IP
if [[ ! "${DETECTED_IP}" =~ / ]]; then
    TARGET_CIDR="${DETECTED_IP}/32"
else
    TARGET_CIDR="${DETECTED_IP}"
fi

echo -e "Target Operator CIDR: ${BOLD}${GREEN}${TARGET_CIDR}${NC}"
echo ""
echo -e "Generating Terraform Plan for ALB Security Group ingress rule update..."
terraform -chdir="${INFRA_DIR}" plan -var="my_ip_cidr=${TARGET_CIDR}" -target=module.network.aws_security_group.alb -out=update_ip.tfplan

echo ""
read -rp "Do you want to apply this CIDR update to AWS? [y/N]: " confirm
if [[ "${confirm}" =~ ^[Yy]$ ]]; then
    terraform -chdir="${INFRA_DIR}" apply update_ip.tfplan
    echo -e "${GREEN}✓ Successfully locked ALB ingress to ${TARGET_CIDR}!${NC}"
else
    echo -e "${YELLOW}Update cancelled.${NC}"
fi
rm -f "${INFRA_DIR}/update_ip.tfplan"
