#!/usr/bin/env bash
# ==============================================================================
# PulseWatch: Stage 6 Demo Extras Interactive Controller
# ==============================================================================
# Allows toggling advanced AWS features during an examiner viva demonstration:
#   1. AWS WAFv2 Web ACL (Managed Common Rules on ALB)
#   2. RDS PostgreSQL Multi-AZ Failover
#   3. RDS Read Replica (db.t4g.micro)
#   4. AWS NAT Gateway (Private Subnet Egress Demo)
#
# IMPORTANT: All extras incur hourly billing. Only run them during the 15-30 min
# viva demonstration and promptly disable them afterwards to conserve credits!
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

echo -e "${BOLD}${CYAN}==============================================================================${NC}"
echo -e "${BOLD}${CYAN}           PulseWatch Stage 6: Interactive Demo Extras Controller            ${NC}"
echo -e "${BOLD}${CYAN}==============================================================================${NC}"

show_menu() {
    echo ""
    echo -e "${BOLD}Select a Demo Extra to toggle or inspect:${NC}"
    echo "  1) [WAFv2]       Toggle AWS WAFv2 Web ACL on ALB (~$0.007/hr + $0.05 demo)"
    echo "  2) [Multi-AZ]    Simulate/Trigger RDS Multi-AZ Failover (~$0.018/hr)"
    echo "  3) [ReadReplica] Toggle RDS PostgreSQL Read Replica (~$0.018/hr)"
    echo "  4) [NAT Gateway] Toggle AWS NAT Gateway in Public Subnet (~$0.054/hr)"
    echo "  5) [SQS Stress]  Trigger synthetic worker scale-out via high queue depth"
    echo "  6) [Status]      View live status of all demo extras"
    echo "  7) [Clean All]   Disable all active extras immediately (Return to baseline)"
    echo "  q) Quit"
    echo ""
    read -rp "Enter choice [1-7/q]: " choice
}

check_status() {
    echo -e "\n${BOLD}${CYAN}--- Live Demo Extras Status ---${NC}"
    
    # Check WAF
    local waf_count
    waf_count=$(aws --profile "${PROFILE}" --region "${REGION}" wafv2 list-web-acls --scope REGIONAL --query "length(WebACLs[?Name=='pulsewatch-alb-waf'])" --output text 2>/dev/null || echo "0")
    if [[ "${waf_count}" -gt 0 ]]; then
        echo -e "  AWS WAFv2:      ${GREEN}ACTIVE${NC} (pulsewatch-alb-waf)"
    else
        echo -e "  AWS WAFv2:      ${YELLOW}DISABLED${NC}"
    fi

    # Check RDS Multi-AZ & Replica
    local rds_multiaz
    rds_multiaz=$(aws --profile "${PROFILE}" --region "${REGION}" rds describe-db-instances --db-instance-identifier pulsewatch-db --query "DBInstances[0].MultiAZ" --output text 2>/dev/null || echo "false")
    echo -e "  RDS Multi-AZ:   $([ "${rds_multiaz}" == "True" ] && echo -e "${GREEN}ENABLED${NC}" || echo -e "${YELLOW}SINGLE-AZ${NC}")"

    local replica_count
    replica_count=$(aws --profile "${PROFILE}" --region "${REGION}" rds describe-db-instances --query "length(DBInstances[?DBInstanceIdentifier=='pulsewatch-db-replica'])" --output text 2>/dev/null || echo "0")
    if [[ "${replica_count}" -gt 0 ]]; then
        echo -e "  RDS ReadReplica:${GREEN}ACTIVE${NC} (pulsewatch-db-replica)"
    else
        echo -e "  RDS ReadReplica:${YELLOW}DISABLED${NC}"
    fi

    # Check NAT Gateway
    local nat_count
    nat_count=$(aws --profile "${PROFILE}" --region "${REGION}" ec2 describe-nat-gateways --filter "Name=tag:Name,Values=pulsewatch-nat-gw" "Name=state,Values=available,pending" --query "length(NatGateways)" --output text 2>/dev/null || echo "0")
    if [[ "${nat_count}" -gt 0 ]]; then
        echo -e "  NAT Gateway:    ${GREEN}ACTIVE${NC} (pulsewatch-nat-gw)"
    else
        echo -e "  NAT Gateway:    ${YELLOW}DISABLED${NC}"
    fi
}

toggle_waf() {
    echo -e "\n${BOLD}${YELLOW}[Action] AWS WAFv2 Web ACL Toggle${NC}"
    echo "Cost: ~$0.007/hr (~$5/month prorated). Adds AWS Managed Common Rule Set to protect ALB from SQLi, XSS, and bad bots."
    read -rp "Enable (e) or Disable (d)? [e/d]: " action
    if [[ "${action}" == "e" ]]; then
        echo -e "${CYAN}Applying Terraform with enable_waf=true...${NC}"
        terraform -chdir="${INFRA_DIR}" apply -var="enable_waf=true" -auto-approve
        echo -e "${GREEN}✓ AWS WAFv2 Web ACL attached to ALB.${NC}"
    elif [[ "${action}" == "d" ]]; then
        echo -e "${CYAN}Applying Terraform with enable_waf=false...${NC}"
        terraform -chdir="${INFRA_DIR}" apply -var="enable_waf=false" -auto-approve
        echo -e "${GREEN}✓ AWS WAFv2 Web ACL removed.${NC}"
    fi
}

toggle_replica() {
    echo -e "\n${BOLD}${YELLOW}[Action] RDS PostgreSQL Read Replica Toggle${NC}"
    echo "Cost: +$0.018/hr. Provisions a db.t4g.micro asynchronous read replica for offloading read traffic."
    read -rp "Enable (e) or Disable (d)? [e/d]: " action
    if [[ "${action}" == "e" ]]; then
        echo -e "${CYAN}Applying Terraform with enable_replica=true...${NC}"
        terraform -chdir="${INFRA_DIR}" apply -var="enable_replica=true" -auto-approve
        echo -e "${GREEN}✓ RDS Read Replica provisioning initiated.${NC}"
    elif [[ "${action}" == "d" ]]; then
        echo -e "${CYAN}Applying Terraform with enable_replica=false...${NC}"
        terraform -chdir="${INFRA_DIR}" apply -var="enable_replica=false" -auto-approve
        echo -e "${GREEN}✓ RDS Read Replica destroyed.${NC}"
    fi
}

toggle_nat() {
    echo -e "\n${BOLD}${YELLOW}[Action] AWS NAT Gateway Toggle${NC}"
    echo "Cost: +$0.054/hr. Provisions an Elastic IP and NAT Gateway in the public subnet."
    read -rp "Enable (e) or Disable (d)? [e/d]: " action
    if [[ "${action}" == "e" ]]; then
        echo -e "${CYAN}Applying Terraform with enable_nat=true...${NC}"
        terraform -chdir="${INFRA_DIR}" apply -var="enable_nat=true" -auto-approve
        echo -e "${GREEN}✓ NAT Gateway provisioning initiated.${NC}"
    elif [[ "${action}" == "d" ]]; then
        echo -e "${CYAN}Applying Terraform with enable_nat=false...${NC}"
        terraform -chdir="${INFRA_DIR}" apply -var="enable_nat=false" -auto-approve
        echo -e "${GREEN}✓ NAT Gateway destroyed.${NC}"
    fi
}

rds_failover() {
    echo -e "\n${BOLD}${YELLOW}[Action] RDS Multi-AZ Reboot with Failover${NC}"
    echo "Note: If the RDS instance is Single-AZ, standard reboot occurs in ~15-30 seconds."
    echo "If converted to Multi-AZ, AWS will switch the primary DNS endpoint to the standby replica in AZ-b."
    read -rp "Proceed with RDS reboot? [y/N]: " confirm
    if [[ "${confirm}" =~ ^[Yy]$ ]]; then
        aws --profile "${PROFILE}" --region "${REGION}" rds reboot-db-instance --db-instance-identifier pulsewatch-db
        echo -e "${GREEN}✓ RDS instance reboot signal dispatched.${NC}"
    fi
}

sqs_stress() {
    echo -e "\n${BOLD}${YELLOW}[Action] SQS Scale-Out Stress Demonstration${NC}"
    echo "Enqueues 25 synthetic check messages into pulsewatch-check-queue to trigger CloudWatch alarm and Worker ASG scale-out (1 -> 3)."
    read -rp "Inject 25 synthetic check jobs? [y/N]: " confirm
    if [[ "${confirm}" =~ ^[Yy]$ ]]; then
        python3 -c "
import boto3, json, time
session = boto3.Session(profile_name='${PROFILE}', region_name='${REGION}')
sqs = session.client('sqs')
queue_url = sqs.get_queue_url(QueueName='pulsewatch-check-queue')['QueueUrl']
print('Injecting 25 synthetic probe messages...')
for i in range(25):
    sqs.send_message(
        QueueUrl=queue_url,
        MessageBody=json.dumps({
            'monitor_id': 'stress-test-' + str(i),
            'url': 'http://10.1.1.111/healthz',
            'expected_status': 200,
            'timeout_sec': 5
        })
    )
print('✓ Injected 25 messages. SQS queue depth will trigger worker scale-out!')
"
    fi
}

clean_all() {
    echo -e "\n${BOLD}${RED}[Action] Disabling all demo extras to baseline...${NC}"
    terraform -chdir="${INFRA_DIR}" apply \
        -var="enable_waf=false" \
        -var="enable_replica=false" \
        -var="enable_nat=false" \
        -auto-approve
    echo -e "${GREEN}✓ All demo extras disabled. Baseline state restored.${NC}"
}

# Non-interactive CLI flags
if [[ $# -gt 0 ]]; then
    case "$1" in
        --status) check_status; exit 0 ;;
        --clean) clean_all; exit 0 ;;
        *) echo "Unknown flag: $1. Usage: $0 [--status | --clean]"; exit 1 ;;
    esac
fi

# Interactive loop
while true; do
    show_menu
    case "${choice}" in
        1) toggle_waf ;;
        2) rds_failover ;;
        3) toggle_replica ;;
        4) toggle_nat ;;
        5) sqs_stress ;;
        6) check_status ;;
        7) clean_all ;;
        q|Q) echo "Exiting demo extras controller."; exit 0 ;;
        *) echo -e "${RED}Invalid option.${NC}" ;;
    esac
done
