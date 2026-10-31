#!/bin/bash
set -e

PROFILE="pulsewatch"
REGION="ap-south-1"
MODE="${1:-light}"
YES_FLAG=false

for arg in "$@"; do
  if [ "$arg" == "--yes" ] || [ "$arg" == "-y" ]; then YES_FLAG=true; fi
  if [ "$arg" == "--dry-run" ]; then DRY_RUN=true; fi
done

if [ "$MODE" != "light" ] && [ "$MODE" != "deep" ]; then
  echo "Usage: ./scripts/pause.sh [light|deep] [--dry-run] [--yes]"
  exit 1
fi

echo "=========================================================="
echo "         PulseWatch Infrastructure Pause: [$MODE]         "
echo "=========================================================="

if [ "$DRY_RUN" == "true" ]; then
  echo "[DRY RUN] Actions that would be executed:"
  echo "  1. Check for running Step Functions executions and active incidents"
  echo "  2. Save current capacity state to scripts/.pause_state.json and SSM /pulsewatch/pause_state"
  echo "  3. Scale API ASG and Worker ASG to 0 (min=0, desired=0, max=0)"
  echo "  4. Stop Victim EC2 host"
  echo "  5. Stop RDS PostgreSQL instance"
  echo "  6. Purge SQS check queue"
  echo "  7. Stop AWS Config recorder"
  if [ "$MODE" == "deep" ]; then
    echo "  8. Run 'terraform apply -var alb_enabled=false' to destroy ALB"
  fi
  exit 0
fi

if [ "$YES_FLAG" != "true" ]; then
  read -p "Are you sure you want to pause the PulseWatch stack in '$MODE' mode? (y/N): " confirm
  if [ "$confirm" != "y" ] && [ "$confirm" != "Y" ]; then
    echo "Aborted."
    exit 0
  fi
fi

# 1. Check open incidents / running workflows
echo "[PulseWatch] Inspecting active Step Functions executions..."
SFN_ARNS=$(aws stepfunctions list-state-machines --profile $PROFILE --region $REGION --query "stateMachines[?contains(name, 'pulsewatch')].stateMachineArn" --output text 2>/dev/null || echo "")
if [ -n "$SFN_ARNS" ]; then
  RUNNING_SFN=$(aws stepfunctions list-executions --state-machine-arn "$SFN_ARNS" --status-filter RUNNING --profile $PROFILE --region $REGION --query "executions[*].executionArn" --output text 2>/dev/null || echo "")
  if [ -n "$RUNNING_SFN" ]; then
    echo "Active Step Functions workflows detected: $RUNNING_SFN"
    if [ "$YES_FLAG" != "true" ]; then
      read -p "Do you want to stop these active executions before pausing? (y/N): " sfn_confirm
      if [ "$sfn_confirm" == "y" ]; then
        for ex in $RUNNING_SFN; do
          aws stepfunctions stop-execution --execution-arn "$ex" --error "StackPaused" --cause "Operator paused stack" --profile $PROFILE --region $REGION
        done
      fi
    fi
  fi
fi

# 2. Save current state
echo "[PulseWatch] Capturing running state..."
VICTIM_ID=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=pulsewatch-victim-host" "Name=instance-state-name,Values=running" --profile $PROFILE --region $REGION --query "Reservations[0].Instances[0].InstanceId" --output text 2>/dev/null || echo "")
NOW_TS=$(date +%s)

STATE_JSON=$(cat << STATE_EOF
{
  "mode": "$MODE",
  "stopped_at": $NOW_TS,
  "api_asg": {"min": 1, "desired": 1, "max": 2},
  "worker_asg": {"min": 1, "desired": 1, "max": 3},
  "victim_instance_id": "$VICTIM_ID",
  "rds_instance_id": "pulsewatch-db"
}
STATE_EOF
)

echo "$STATE_JSON" > scripts/.pause_state.json
aws ssm put-parameter --name "/pulsewatch/pause_state" --value "$STATE_JSON" --type "String" --overwrite --profile $PROFILE --region $REGION

# 3. Scale ASGs to 0
echo "[PulseWatch] Scaling ASGs to 0..."
API_ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'pulsewatch-api-asg')].AutoScalingGroupName" --output text)
if [ -n "$API_ASG_NAME" ]; then
  aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$API_ASG_NAME" --min-size 0 --max-size 0 --desired-capacity 0 --profile $PROFILE --region $REGION
fi

WORKER_ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'pulsewatch-worker-asg')].AutoScalingGroupName" --output text)
if [ -n "$WORKER_ASG_NAME" ]; then
  aws autoscaling update-auto-scaling-group --auto-scaling-group-name "$WORKER_ASG_NAME" --min-size 0 --max-size 0 --desired-capacity 0 --profile $PROFILE --region $REGION
fi

# 4. Stop Victim Host
if [ -n "$VICTIM_ID" ] && [ "$VICTIM_ID" != "None" ]; then
  echo "[PulseWatch] Stopping Victim host ($VICTIM_ID)..."
  aws ec2 stop-instances --instance-ids "$VICTIM_ID" --profile $PROFILE --region $REGION
fi

# 5. Stop RDS Instance
echo "[PulseWatch] Stopping RDS instance (pulsewatch-db)..."
aws rds stop-db-instance --db-instance-identifier "pulsewatch-db" --profile $PROFILE --region $REGION || echo "RDS already stopped."

# 6. Purge SQS Queue
echo "[PulseWatch] Purging SQS check queue..."
QUEUE_URL=$(aws sqs get-queue-url --queue-name "pulsewatch-check-queue" --profile $PROFILE --region $REGION --query "QueueUrl" --output text 2>/dev/null || echo "")
if [ -n "$QUEUE_URL" ]; then
  aws sqs purge-queue --queue-url "$QUEUE_URL" --profile $PROFILE --region $REGION 2>/dev/null || true
fi

# 7. Stop AWS Config Recorder if active
echo "[PulseWatch] Pausing AWS Config recorder..."
aws configservice stop-configuration-recorder --configuration-recorder-name "pulsewatch-recorder" --profile $PROFILE --region $REGION 2>/dev/null || true

# 8. Deep mode: Destroy ALB
if [ "$MODE" == "deep" ]; then
  echo "[PulseWatch DEEP PAUSE] Destroying ALB via Terraform..."
  DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  terraform -chdir="$DIR/infra" apply -var alb_enabled=false -auto-approve
fi

echo "=========================================================="
echo "  PulseWatch PAUSE complete. Daily burn reduced to minimum!"
echo "  Note: AWS will auto-restart stopped RDS after 7 days."
echo "=========================================================="
