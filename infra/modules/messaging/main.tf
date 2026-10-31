variable "alert_email" { type = string }
variable "kms_key_arn" { type = string }

# -------------------------------------------------------------
# Amazon SQS: Check Job Buffer Queue + Dead-Letter Queue (DLQ)
# -------------------------------------------------------------

resource "aws_sqs_queue" "check_dlq" {
  name                      = "pulsewatch-check-dlq"
  message_retention_seconds = 1209600 # 14 days
  kms_master_key_id         = var.kms_key_arn

  tags = { Name = "pulsewatch-check-dlq" }
}

resource "aws_sqs_queue" "check_queue" {
  name                       = "pulsewatch-check-queue"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 86400 # 1 day
  kms_master_key_id          = var.kms_key_arn

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.check_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "pulsewatch-check-queue" }
}

# -------------------------------------------------------------
# Amazon SNS: Email Subscription Only (No webhooks/bots)
# -------------------------------------------------------------

resource "aws_sns_topic" "alerts" {
  name              = "pulsewatch-alerts-topic"
  kms_master_key_id = var.kms_key_arn

  tags = { Name = "pulsewatch-alerts-topic" }
}

resource "aws_sns_topic_subscription" "email" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

output "check_queue_id" { value = aws_sqs_queue.check_queue.id }
output "check_queue_arn" { value = aws_sqs_queue.check_queue.arn }
output "check_dlq_arn" { value = aws_sqs_queue.check_dlq.arn }
output "alerts_topic_arn" { value = aws_sns_topic.alerts.arn }
