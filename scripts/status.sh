#!/bin/bash
set -e

PROFILE="pulsewatch"
REGION="ap-south-1"

echo "=========================================================="
echo "          PulseWatch Cloud Infrastructure Status          "
echo "=========================================================="

# 1. ASGs
echo -e "\n[1. Auto Scaling Groups]"
API_ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'pulsewatch-api')].AutoScalingGroupName" --output text | awk '{print $1}')
API_ASG=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --auto-scaling-group-names "$API_ASG_NAME" --query "AutoScalingGroups[0].[DesiredCapacity,MinSize,MaxSize,length(Instances)]" --output text 2>/dev/null || echo "None")
echo "API ASG (Desired/Min/Max/Running):    $API_ASG"

WORKER_ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --query "AutoScalingGroups[?contains(AutoScalingGroupName, 'pulsewatch-worker')].AutoScalingGroupName" --output text | awk '{print $1}')
WORKER_ASG=$(aws autoscaling describe-auto-scaling-groups --profile $PROFILE --region $REGION --auto-scaling-group-names "$WORKER_ASG_NAME" --query "AutoScalingGroups[0].[DesiredCapacity,MinSize,MaxSize,length(Instances)]" --output text 2>/dev/null || echo "None")
echo "Worker ASG (Desired/Min/Max/Running): $WORKER_ASG"

# 2. RDS Status & Warning Checks
echo -e "\n[2. Database Tier]"
RDS_STATUS=$(aws rds describe-db-instances --db-instance-identifier pulsewatch-db --profile $PROFILE --region $REGION --query "DBInstances[0].DBInstanceStatus" --output text 2>/dev/null || echo "Not Found")
echo "RDS PostgreSQL Status: $RDS_STATUS"

# Check if paused state recorded in SSM
PAUSE_STATE=$(aws ssm get-parameter --name "/pulsewatch/pause_state" --profile $PROFILE --region $REGION --query "Parameter.Value" --output text 2>/dev/null || echo "")
if [ -n "$PAUSE_STATE" ]; then
  STOP_TIME=$(echo "$PAUSE_STATE" | grep -o '"stopped_at":[^,]*' | cut -d':' -f2 | tr -d ' "')
  if [ -n "$STOP_TIME" ]; then
    NOW_SEC=$(date +%s)
    DIFF_DAYS=$(( (NOW_SEC - STOP_TIME) / 86400 ))
    echo "  -> Stack marked PAUSED $DIFF_DAYS days ago."
    if [ "$DIFF_DAYS" -ge 6 ]; then
      echo "  ⚠️ [CRITICAL WARNING] RDS has been stopped for $DIFF_DAYS days! AWS will auto-restart stopped RDS instances after 7 days!"
    fi
  fi
  if [ "$RDS_STATUS" == "available" ]; then
    echo "  ⚠️ [ANOMALY WARNING] Stack is recorded as PAUSED, but RDS is currently RUNNING!"
  fi
fi

# 3. Victim Host
echo -e "\n[3. Victim Test Host]"
VICTIM_STATE=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=pulsewatch-victim-host" --profile $PROFILE --region $REGION --query "Reservations[0].Instances[0].{State:State.Name,PrivateIp:PrivateIpAddress}" --output text 2>/dev/null || echo "Not Found")
echo "Victim Host:  $VICTIM_STATE"

# 4. ALB Status
echo -e "\n[4. Load Balancer Ingress]"
ALB_STATE=$(aws elbv2 describe-load-balancers --names "pulsewatch-alb" --profile $PROFILE --region $REGION --query "LoadBalancers[0].State.Code" --output text 2>/dev/null || echo "DESTROYED / NOT RUNNING")
echo "ALB State:    $ALB_STATE"

# 5. SQS Check Queue
echo -e "\n[5. SQS Queue Telemetry]"
QUEUE_URL=$(aws sqs get-queue-url --queue-name "pulsewatch-check-queue" --profile $PROFILE --region $REGION --query "QueueUrl" --output text 2>/dev/null || echo "")
if [ -n "$QUEUE_URL" ]; then
  ATTRS=$(aws sqs get-queue-attributes --queue-url "$QUEUE_URL" --attribute-names ApproximateNumberOfMessages ApproximateNumberOfMessagesNotVisible --profile $PROFILE --region $REGION --query "Attributes" --output text 2>/dev/null || echo "")
  echo "Queue Messages Visible/InFlight: $ATTRS"
fi

# 6. SNS Alert Subscriptions
echo -e "\n[6. SNS Alert Topic & Email Subscriptions]"
SNS_TOPIC_ARN=$(aws sns list-topics --profile $PROFILE --region $REGION --query "Topics[?contains(TopicArn, 'pulsewatch-alerts-topic')].TopicArn" --output text 2>/dev/null | awk '{print $1}')
if [ -n "$SNS_TOPIC_ARN" ]; then
  SNS_CONFIRMED=$(aws sns get-topic-attributes --topic-arn "$SNS_TOPIC_ARN" --profile $PROFILE --region $REGION --query "Attributes.SubscriptionsConfirmed" --output text 2>/dev/null || echo "0")
  SNS_PENDING=$(aws sns get-topic-attributes --topic-arn "$SNS_TOPIC_ARN" --profile $PROFILE --region $REGION --query "Attributes.SubscriptionsPending" --output text 2>/dev/null || echo "0")
  echo "SNS Confirmed Subscriptions: $SNS_CONFIRMED | Pending Subscriptions: $SNS_PENDING"
  if [ "$SNS_PENDING" -gt 0 ] || [ "$SNS_CONFIRMED" -eq 0 ]; then
    echo "  ⚠️ [CRITICAL WARNING] SNS email alerts will NOT be delivered! Subscription is PendingConfirmation. Recipient must click the confirmation link sent by AWS."
  fi
fi

# 7. Current Burn Estimate
echo -e "\n[7. Estimated Current Run Rate]"
HOURLY=0.00
if [ "$RDS_STATUS" == "available" ]; then HOURLY=$(echo "$HOURLY + 0.0180" | bc); fi
if echo "$VICTIM_STATE" | grep -q "running"; then HOURLY=$(echo "$HOURLY + 0.0104" | bc); fi
if [ "$ALB_STATE" == "active" ]; then HOURLY=$(echo "$HOURLY + 0.0225" | bc); fi
if echo "$API_ASG" | grep -qv "0"; then HOURLY=$(echo "$HOURLY + 0.0052" | bc); fi
if echo "$WORKER_ASG" | grep -qv "0"; then HOURLY=$(echo "$HOURLY + 0.0052" | bc); fi

MONTHLY=$(echo "$HOURLY * 730" | bc)
printf "Estimated Current Burn: ~\$%.4f / hour (~\$%.2f / month)\n" "$HOURLY" "$MONTHLY"
echo "=========================================================="
