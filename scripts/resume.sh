#!/bin/bash
set -e

PROFILE="pulsewatch"
REGION="ap-south-1"
YES_FLAG=false

for arg in "$@"; do
  if [ "$arg" == "--yes" ] || [ "$arg" == "-y" ]; then YES_FLAG=true; fi
  if [ "$arg" == "--dry-run" ]; then DRY_RUN=true; fi
done

echo "=========================================================="
echo "          PulseWatch Infrastructure RESUME                "
echo "=========================================================="

# Read saved state
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_JSON=""
if [ -f "$DIR/scripts/.pause_state.json" ]; then
  STATE_JSON=$(cat "$DIR/scripts/.pause_state.json")
else
  STATE_JSON=$(aws ssm get-parameter --name "/pulsewatch/pause_state" --profile $PROFILE --region $REGION --query "Parameter.Value" --output text 2>/dev/null || echo "")
fi

MODE="light"
if echo "$STATE_JSON" | grep -q '"mode": "deep"'; then
  MODE="deep"
fi

if [ "$DRY_RUN" == "true" ]; then
  echo "[DRY RUN] Actions that would be executed:"
  if [ "$MODE" == "deep" ]; then
    echo "  1. Run 'terraform apply -var alb_enabled=true' to provision ALB and listeners"
  fi
  echo "  2. Start RDS PostgreSQL instance (pulsewatch-db)"
  echo "  3. Start Victim EC2 host"
  echo "  4. Restore API ASG (min 1, desired 1, max 2)"
  echo "  5. Restore Worker ASG (min 1, desired 1, max 3)"
  echo "  6. Clean orphan STATE items from DynamoDB pulsewatch-incidents"
  echo "  7. Resume AWS Config recorder"
  echo "  8. Run smoke check via CloudFront URL"
  exit 0
fi

if [ "$YES_FLAG" != "true" ]; then
  read -p "Are you sure you want to resume the PulseWatch stack? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

# 1. If deep mode, re-provision ALB via Terraform
if [ "$MODE" == "deep" ]; then
  echo "[PulseWatch] Deep mode detected. Re-provisioning ALB via Terraform..."
  terraform -chdir="$DIR/infra" apply -var alb_enabled=true -auto-approve
fi

# 2. Start RDS
echo "[PulseWatch] Starting RDS instance (pulsewatch-db)..."
aws rds start-db-instance --db-instance-identifier "pulsewatch-db" --profile $PROFILE --region $REGION || echo "RDS already running or starting."

# 3. Start Victim Host
VICTIM_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=pulsewatch-victim-host" "Name=instance-state-name,Values=stopped" --profile $PROFILE --region $REGION --query "Reservations[0].Instances[0].InstanceId" --output text 2>/dev/null || echo "")
if [ -n "$VICTIM_ID" ] && [ "$VICTIM_ID" != "None" ]; then
  echo "[PulseWatch] Starting Victim host ($VICTIM_ID)..."
  aws ec2 start-instances --instance-ids "$VICTIM_ID" --profile $PROFILE --region $REGION
fi

# 4. Restore ASGs
echo "[PulseWatch] Restoring API & Worker Auto Scaling Groups..."
API_ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'pulsewatch-api-asg')].AutoScalingGroupName" --output text)
if [ -n "$API_ASG_NAME" ]; then
  aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$API_ASG_NAME" --min-size 1 --max-size 2 --desired-capacity 1 --profile $PROFILE --region $REGION
fi

WORKER_ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'pulsewatch-worker-asg')].AutoScalingGroupName" --output text)
if [ -n "$WORKER_ASG_NAME" ]; then
  aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$WORKER_ASG_NAME" --min-size 1 --max-size 3 --desired-capacity 1 --profile $PROFILE --region $REGION
fi

# 5. Check and clean orphan STATE items in DynamoDB
echo "[PulseWatch] Inspecting Step Functions executions and DynamoDB STATE items..."
SFN_ARN=$(aws stepfunctions list-state-machines --profile $PROFILE --region $REGION --query "stateMachines[?contains(name, 'pulsewatch')].stateMachineArn" --output text 2>/dev/null || true)
RUNNING_EXECS=""
if [ -n "$SFN_ARN" ]; then
  RUNNING_EXECS=$(aws stepfunctions list-executions --state-machine-arn "$SFN_ARN" --status-filter RUNNING --profile $PROFILE --region $REGION --query "executions[*].name" --output text 2>/dev/null || true)
fi

STATE_ITEMS=$(aws dynamodb scan --table-name "pulsewatch-incidents" --filter-expression "item_id = :st" --expression-attribute-values '{":st":{"S":"STATE"}}' --projection-expression "monitor_id, item_id" --profile $PROFILE --region $REGION --query "Items" --output json 2>/dev/null || echo "[]")
ITEM_COUNT=$(echo "$STATE_ITEMS" | grep -o 'monitor_id' | wc -l || echo 0)

if [ "$ITEM_COUNT" -gt 0 ]; then
  echo "$STATE_ITEMS" | jq -c '.[]' 2>/dev/null | while read -r item; do
    MON_ID=$(echo "$item" | jq -r '.monitor_id.S')
    # Check if there is a running execution matching this monitor_id prefix
    MON_SHORT="${MON_ID:0:16}"
    IS_ACTIVE=$(echo "$RUNNING_EXECS" | grep -o "inc-$MON_SHORT" || true)
    if [ -z "$IS_ACTIVE" ]; then
      echo "  - Deleting orphan STATE item for monitor $MON_ID (no active SFN execution)..."
      aws dynamodb delete-item --table-name "pulsewatch-incidents" \
        --key "{\"monitor_id\": {\"S\": \"$MON_ID\"}, \"item_id\": {\"S\": \"STATE\"}}" \
        --profile $PROFILE --region $REGION || true
    else
      echo "  - Active SFN execution found for monitor $MON_ID. Retaining STATE item."
    fi
  done
else
  echo "  - No orphan STATE items found."
fi

# 6. Verify SNS Email Subscription Confirmation
TOPIC_ARN=$(aws sns list-topics --profile $PROFILE --region $REGION --query "Topics[?contains(TopicArn, 'pulsewatch')].TopicArn" --output text 2>/dev/null || true)
if [ -n "$TOPIC_ARN" ]; then
  PENDING_SUB=$(aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --profile $PROFILE --region $REGION --query "Subscriptions[?SubscriptionArn=='PendingConfirmation'].Endpoint" --output text 2>/dev/null || true)
  if [ -n "$PENDING_SUB" ]; then
    echo "=========================================================="
    echo "  [WARNING] SNS Email Subscription for '$PENDING_SUB' is PENDING CONFIRMATION!"
    echo "  Incident DOWN/RECOVERED emails will not arrive until you click the confirmation link in your inbox."
    echo "=========================================================="
  fi
fi

# 7. Resume Config recorder
aws configservice start-configuration-recorder --configuration-recorder-name "pulsewatch-recorder" --profile $PROFILE --region $REGION 2>/dev/null || true

# 8. Clear pause record
aws ssm delete-parameter --name "/pulsewatch/pause_state" --profile $PROFILE --region $REGION 2>/dev/null || true
rm -f "$DIR/scripts/.pause_state.json"

echo "=========================================================="
echo "  PulseWatch RESUME initiated. Run ./scripts/status.sh to check health."
echo "=========================================================="
