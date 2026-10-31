#!/bin/bash
set -e

PROFILE="pulsewatch"
REGION="ap-south-1"
ACTION="${1:-status}"

echo "=========================================================="
echo "         PulseWatch Outage Simulation: [$ACTION]          "
echo "=========================================================="

# Find Victim EC2 instance ID
VICTIM_ID=$(aws ec2 describe-instances \
  --filters "Name=tag:Name,Values=pulsewatch-victim-host" "Name=instance-state-name,Values=running" \
  --profile "$PROFILE" --region "$REGION" \
  --query "Reservations[0].Instances[0].InstanceId" --output text 2>/dev/null || echo "")

if [ -z "$VICTIM_ID" ] || [ "$VICTIM_ID" == "None" ]; then
  echo "Error: Victim EC2 host (pulsewatch-victim-host) is not running!"
  exit 1
fi

echo "Target Victim Instance: $VICTIM_ID (10.1.1.111)"

if [ "$ACTION" == "start" ] || [ "$ACTION" == "down" ]; then
  echo "[Outage Demo] Stopping Nginx on victim host via SSM..."
  CMD_ID=$(aws ssm send-command \
    --instance-ids "$VICTIM_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["systemctl stop nginx", "systemctl status nginx --no-pager || true"]' \
    --profile "$PROFILE" --region "$REGION" \
    --query "Command.CommandId" --output text)

  echo "SSM Command dispatched: $CMD_ID"
  sleep 4
  aws ssm get-command-invocation \
    --command-id "$CMD_ID" \
    --instance-id "$VICTIM_ID" \
    --profile "$PROFILE" --region "$REGION" \
    --query "StandardOutputContent" --output text

  echo ""
  echo "✅ Nginx has been STOPPED on 10.1.1.111!"
  echo "-> Next scheduled check will fail."
  echo "-> DynamoDB Stream will trigger Lambda filter."
  echo "-> Step Functions state machine will run worker fleet re-checks."
  echo "-> After re-checks fail, DOWN alert email will be published to SNS."

elif [ "$ACTION" == "stop" ] || [ "$ACTION" == "recover" ] || [ "$ACTION" == "up" ]; then
  echo "[Outage Demo] Starting Nginx on victim host via SSM..."
  CMD_ID=$(aws ssm send-command \
    --instance-ids "$VICTIM_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["systemctl start nginx", "systemctl status nginx --no-pager", "curl -s -o /dev/null -w \"%{http_code}\" http://localhost/healthz"]' \
    --profile "$PROFILE" --region "$REGION" \
    --query "Command.CommandId" --output text)

  echo "SSM Command dispatched: $CMD_ID"
  sleep 4
  aws ssm get-command-invocation \
    --command-id "$CMD_ID" \
    --instance-id "$VICTIM_ID" \
    --profile "$PROFILE" --region "$REGION" \
    --query "StandardOutputContent" --output text

  echo ""
  echo "✅ Nginx has been RESTORED on 10.1.1.111!"
  echo "-> Step Functions recovery loop will detect HTTP 200."
  echo "-> Incident state in DynamoDB will transition to UP/RESOLVED."
  echo "-> RECOVERED notification email will be published to SNS."

elif [ "$ACTION" == "status" ]; then
  echo "[Outage Demo] Checking Nginx status on victim host..."
  CMD_ID=$(aws ssm send-command \
    --instance-ids "$VICTIM_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters 'commands=["systemctl is-active nginx || echo inactive", "curl -s -o /dev/null -w \"HTTP %{http_code}\" http://localhost/healthz || echo \"Unreachable\""]' \
    --profile "$PROFILE" --region "$REGION" \
    --query "Command.CommandId" --output text)

  sleep 3
  aws ssm get-command-invocation \
    --command-id "$CMD_ID" \
    --instance-id "$VICTIM_ID" \
    --profile "$PROFILE" --region "$REGION" \
    --query "StandardOutputContent" --output text

  echo -e "\n[DynamoDB Incident State]:"
  aws dynamodb scan --table-name "pulsewatch-incidents" \
    --profile "$PROFILE" --region "$REGION" \
    --max-items 5 --output json 2>/dev/null || echo "No incident items"

else
  echo "Usage: ./scripts/demo-outage.sh [start|stop|status]"
  exit 1
fi

echo "=========================================================="
