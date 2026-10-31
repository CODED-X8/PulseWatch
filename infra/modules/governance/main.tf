variable "aws_region" { 
  type    = string 
  default = "ap-south-1"
}
variable "account_id" { 
  type    = string 
  default = ""
}
variable "environment" { 
  type    = string 
  default = "prod"
}
variable "alert_email" { type = string }
variable "alerts_topic_arn" { 
  type    = string 
  default = ""
}
variable "kms_key_arn" { 
  type    = string 
  default = ""
}
variable "alb_arn" { 
  type    = string 
  default = ""
}
variable "alb_enabled" { 
  type    = bool 
  default = true 
}

# -------------------------------------------------------------
# 1. AWS Budgets: Spend Alerts ($20, $35, $50)
# -------------------------------------------------------------

resource "aws_budgets_budget" "pulsewatch_cost_budget" {
  name              = "pulsewatch-cost-budget"
  budget_type       = "COST"
  limit_amount      = "35"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-10-01_00:00"

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 50
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 100
    threshold_type             = "PERCENTAGE"
    notification_type          = "FORECASTED"
    subscriber_email_addresses = [var.alert_email]
  }
}

# -------------------------------------------------------------
# 2. Amazon CloudWatch Metric Alarms
# -------------------------------------------------------------

# Alarm: SQS Dead-Letter Queue contains messages
resource "aws_cloudwatch_metric_alarm" "dlq_has_messages" {
  alarm_name          = "pulsewatch-sqs-dlq-messages"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 1
  treat_missing_data  = "notBreaching"
  alarm_description   = "Alarm when SQS Dead-Letter Queue contains 1 or more poisoned check tasks"
  alarm_actions       = var.alerts_topic_arn != "" ? [var.alerts_topic_arn] : []

  dimensions = {
    QueueName = "pulsewatch-check-dlq"
  }
}

# Alarm: RDS CPU Utilization > 80%
resource "aws_cloudwatch_metric_alarm" "rds_high_cpu" {
  alarm_name          = "pulsewatch-rds-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/RDS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  treat_missing_data  = "notBreaching"
  alarm_description   = "Alarm when RDS PostgreSQL CPU utilization exceeds 80% for 10 minutes"
  alarm_actions       = var.alerts_topic_arn != "" ? [var.alerts_topic_arn] : []

  dimensions = {
    DBInstanceIdentifier = "pulsewatch-db"
  }
}

# -------------------------------------------------------------
# 3. Amazon CloudWatch Operational Dashboard
# -------------------------------------------------------------

resource "aws_cloudwatch_dashboard" "pulsewatch_overview" {
  dashboard_name = "pulsewatch-overview"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/SQS", "ApproximateNumberOfMessagesVisible", "QueueName", "pulsewatch-check-queue", { "label" = "Queue Backlog", "color" = "#1f77b4" }],
            [".", "ApproximateNumberOfMessagesNotVisible", ".", ".", { "label" = "In-Flight Checks", "color" = "#ff7f0e" }],
            [".", "ApproximateNumberOfMessagesVisible", "QueueName", "pulsewatch-check-dlq", { "label" = "DLQ Poison Messages", "color" = "#d62728" }]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "SQS Check Queue Backlog & In-Flight Telemetry"
          period  = 60
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/RDS", "CPUUtilization", "DBInstanceIdentifier", "pulsewatch-db", { "label" = "RDS CPU %", "color" = "#2ca02c" }],
            [".", "DatabaseConnections", ".", ".", { "label" = "DB Connections", "yAxis" = "right", "color" = "#9467bd" }]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "RDS PostgreSQL Utilization & Connection Pool"
          period  = 60
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["PulseWatch/Metrics", "SitesDown", { "label" = "Active Down Incidents", "color" = "#d62728" }]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "Active Sites Down Metric"
          period  = 60
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 6
        width  = 12
        height = 6
        properties = {
          metrics = [
            ["AWS/ApplicationELB", "RequestCount", "LoadBalancer", "app/pulsewatch-alb", { "label" = "ALB Requests", "stat" = "Sum" }],
            [".", "TargetResponseTime", ".", ".", { "label" = "Target Latency (s)", "yAxis" = "right", "stat" = "Average" }]
          ]
          view    = "timeSeries"
          stacked = false
          region  = var.aws_region
          title   = "ALB Ingress Traffic & API Latency"
          period  = 60
        }
      }
    ]
  })
}

# -------------------------------------------------------------
# 4. AWS CloudTrail: Audit Management Events
# -------------------------------------------------------------

resource "aws_s3_bucket" "cloudtrail_logs" {
  count         = var.account_id != "" ? 1 : 0
  bucket        = "pulsewatch-cloudtrail-${var.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "cloudtrail_logs" {
  count  = var.account_id != "" ? 1 : 0
  bucket = aws_s3_bucket.cloudtrail_logs[0].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "cloudtrail_logs" {
  count                   = var.account_id != "" ? 1 : 0
  bucket                  = aws_s3_bucket.cloudtrail_logs[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "cloudtrail_logs" {
  count  = var.account_id != "" ? 1 : 0
  bucket = aws_s3_bucket.cloudtrail_logs[0].id

  rule {
    id     = "cloudtrail-retention"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 365
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "cloudtrail_logs" {
  count  = var.account_id != "" ? 1 : 0
  bucket = aws_s3_bucket.cloudtrail_logs[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSCloudTrailAclCheck"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.cloudtrail_logs[0].arn
      },
      {
        Sid    = "AWSCloudTrailWrite"
        Effect = "Allow"
        Principal = {
          Service = "cloudtrail.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.cloudtrail_logs[0].arn}/AWSLogs/${var.account_id}/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

resource "aws_cloudtrail" "main" {
  count                         = var.account_id != "" ? 1 : 0
  name                          = "pulsewatch-cloudtrail"
  s3_bucket_name                = aws_s3_bucket.cloudtrail_logs[0].id
  include_global_service_events = true
  is_multi_region_trail         = false
  enable_log_file_validation    = true

  depends_on = [aws_s3_bucket_policy.cloudtrail_logs]

  tags = { Name = "pulsewatch-cloudtrail" }
}

# -------------------------------------------------------------
# 5. AWS Config: Managed Compliance Rules
# -------------------------------------------------------------

resource "aws_iam_role" "config_role" {
  name = "pulsewatch-config-service-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "config.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "config_role_attachment" {
  role       = aws_iam_role.config_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWS_ConfigRole"
}

resource "aws_s3_bucket" "config_bucket" {
  count         = var.account_id != "" ? 1 : 0
  bucket        = "pulsewatch-config-${var.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "config_bucket" {
  count                   = var.account_id != "" ? 1 : 0
  bucket                  = aws_s3_bucket.config_bucket[0].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "config_bucket" {
  count  = var.account_id != "" ? 1 : 0
  bucket = aws_s3_bucket.config_bucket[0].id

  rule {
    id     = "config-retention"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 365
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_bucket_policy" "config_bucket_policy" {
  count  = var.account_id != "" ? 1 : 0
  bucket = aws_s3_bucket.config_bucket[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AWSConfigBucketPermissionsCheck"
        Effect = "Allow"
        Principal = {
          Service = "config.amazonaws.com"
        }
        Action   = "s3:GetBucketAcl"
        Resource = aws_s3_bucket.config_bucket[0].arn
      },
      {
        Sid    = "AWSConfigBucketExistenceCheck"
        Effect = "Allow"
        Principal = {
          Service = "config.amazonaws.com"
        }
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.config_bucket[0].arn
      },
      {
        Sid    = "AWSConfigBucketDelivery"
        Effect = "Allow"
        Principal = {
          Service = "config.amazonaws.com"
        }
        Action   = "s3:PutObject"
        Resource = "${aws_s3_bucket.config_bucket[0].arn}/AWSLogs/${var.account_id}/Config/*"
        Condition = {
          StringEquals = {
            "s3:x-amz-acl" = "bucket-owner-full-control"
          }
        }
      }
    ]
  })
}

resource "aws_config_configuration_recorder" "recorder" {
  name     = "pulsewatch-recorder"
  role_arn = aws_iam_role.config_role.arn

  recording_group {
    all_supported                 = false
    include_global_resource_types = false
    resource_types = [
      "AWS::S3::Bucket",
      "AWS::EC2::SecurityGroup",
      "AWS::EC2::Volume"
    ]
  }
}

resource "aws_config_delivery_channel" "delivery_channel" {
  count          = var.account_id != "" ? 1 : 0
  name           = "pulsewatch-delivery-channel"
  s3_bucket_name = aws_s3_bucket.config_bucket[0].id

  snapshot_delivery_properties {
    delivery_frequency = "TwentyFour_Hours"
  }

  depends_on = [aws_s3_bucket_policy.config_bucket_policy, aws_config_configuration_recorder.recorder]
}

resource "aws_config_configuration_recorder_status" "recorder_status" {
  count      = var.account_id != "" ? 1 : 0
  name       = aws_config_configuration_recorder.recorder.name
  is_enabled = true

  depends_on = [aws_config_delivery_channel.delivery_channel]
}

# Config Rule: S3 Buckets enforce SSL requests only
resource "aws_config_config_rule" "s3_ssl_only" {
  name        = "s3-bucket-ssl-requests-only"
  description = "Checks whether S3 buckets require requests to use Secure Socket Layer (SSL)."

  source {
    owner             = "AWS"
    source_identifier = "S3_BUCKET_SSL_REQUESTS_ONLY"
  }

  depends_on = [aws_config_configuration_recorder.recorder]
}

# Config Rule: Restricted SSH (no 0.0.0.0/0 on port 22)
resource "aws_config_config_rule" "restricted_ssh" {
  name        = "restricted-ssh"
  description = "Checks whether security groups permit unrestricted incoming SSH traffic (port 22)."

  source {
    owner             = "AWS"
    source_identifier = "INCOMING_SSH_DISABLED"
  }

  depends_on = [aws_config_configuration_recorder.recorder]
}

# Config Rule: Encrypted EBS Volumes
resource "aws_config_config_rule" "encrypted_volumes" {
  name        = "encrypted-volumes"
  description = "Checks whether EBS volumes are configured to be encrypted at rest."

  source {
    owner             = "AWS"
    source_identifier = "ENCRYPTED_VOLUMES"
  }

  depends_on = [aws_config_configuration_recorder.recorder]
}

output "cloudtrail_arn" { value = length(aws_cloudtrail.main) > 0 ? aws_cloudtrail.main[0].arn : "" }
output "cloudwatch_dashboard_name" { value = aws_cloudwatch_dashboard.pulsewatch_overview.dashboard_name }
