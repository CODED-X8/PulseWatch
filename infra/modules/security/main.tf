variable "aws_region" { type = string }
variable "account_id" { type = string }
variable "environment" { type = string }
variable "admin_email" { type = string }
variable "alert_email" { type = string }
variable "jwt_secret" { type = string }
variable "origin_verify_secret" { type = string }

# Customer-Managed KMS Key for Encryption at Rest
resource "aws_kms_key" "pulsewatch" {
  description             = "Customer managed KMS key for PulseWatch EBS, RDS, and SSM encryption"
  deletion_window_in_days = 7
  enable_key_rotation     = true

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EnableRootAdmin"
        Effect = "Allow"
        Principal = {
          AWS = "arn:aws:iam::${var.account_id}:root"
        }
        Action   = "kms:*"
        Resource = "*"
      },
      {
        Sid    = "AllowCloudWatchLogs"
        Effect = "Allow"
        Principal = {
          Service = "logs.${var.aws_region}.amazonaws.com"
        }
        Action = [
          "kms:Encrypt*",
          "kms:Decrypt*",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:Describe*"
        ]
        Resource = "*"
      },
      {
        Sid    = "AllowSNSService"
        Effect = "Allow"
        Principal = {
          Service = "sns.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey*"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = var.account_id
          }
        }
      },
      {
        Sid    = "AllowCloudWatchAlarms"
        Effect = "Allow"
        Principal = {
          Service = "cloudwatch.amazonaws.com"
        }
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey*"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:SourceAccount" = var.account_id
          }
        }
      }
    ]
  })
}

resource "aws_kms_alias" "pulsewatch" {
  name          = "alias/pulsewatch-kms"
  target_key_id = aws_kms_key.pulsewatch.key_id
}

# SSM Parameter Store: Secrets & Configuration
resource "aws_ssm_parameter" "admin_email" {
  name        = "/pulsewatch/admin_email"
  description = "Admin email address authorized for privileged demo endpoints"
  type        = "String"
  value       = var.admin_email
  overwrite   = true
}

resource "aws_ssm_parameter" "alert_email" {
  name        = "/pulsewatch/alert_email"
  description = "Target email for confirmed incident alert dispatches"
  type        = "String"
  value       = var.alert_email
  overwrite   = true
}

resource "aws_ssm_parameter" "jwt_secret" {
  name        = "/pulsewatch/jwt_secret"
  description = "HMAC-SHA256 signature secret for API bearer tokens"
  type        = "SecureString"
  key_id      = aws_kms_key.pulsewatch.arn
  value       = var.jwt_secret
  overwrite   = true
}

resource "aws_ssm_parameter" "origin_verify_secret" {
  name        = "/pulsewatch/origin_verify_secret"
  description = "Custom header value passed by CloudFront to validate ALB requests"
  type        = "SecureString"
  key_id      = aws_kms_key.pulsewatch.arn
  value       = var.origin_verify_secret
  overwrite   = true
}

resource "aws_ssm_parameter" "allowed_private_hosts" {
  name        = "/pulsewatch/allowed_private_hosts"
  description = "SSRF bypass allowlist for safe internal probing (comma-separated)"
  type        = "String"
  value       = "10.1.1.50,victim.pulsewatch.internal"
  overwrite   = true
}

resource "aws_ssm_parameter" "reports_bucket" {
  name        = "/pulsewatch/reports_bucket"
  description = "Dedicated S3 bucket for CSV incident reports"
  type        = "String"
  value       = "pulsewatch-reports-${var.account_id}"
  overwrite   = true
}

# IAM Role & Instance Profile for API EC2 Instances
resource "aws_iam_role" "api_instance_role" {
  name = "pulsewatch-api-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "api_ssm_core" {
  role       = aws_iam_role.api_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "api_custom_policy" {
  name = "pulsewatch-api-policy"
  role = aws_iam_role.api_instance_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMParametersAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/pulsewatch/*"
      },
      {
        Sid    = "KMSAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKey*"
        ]
        Resource = aws_kms_key.pulsewatch.arn
      },
      {
        Sid    = "SQSSendAccess"
        Effect = "Allow"
        Action = [
          "sqs:SendMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = "arn:aws:sqs:${var.aws_region}:${var.account_id}:pulsewatch-*"
      },
      {
        Sid    = "DynamoDBReadAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:DescribeTable"
        ]
        Resource = [
          "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/pulsewatch-*",
          "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/pulsewatch-*/index/*"
        ]
      },
      {
        Sid    = "S3ReportsAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject"
        ]
        Resource = "arn:aws:s3:::pulsewatch-reports-${var.account_id}/*"
      },
      {
        Sid    = "S3ArtifactsRead"
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "arn:aws:s3:::pulsewatch-artifacts-${var.account_id}/*"
      },
      {
        Sid    = "CloudWatchMetrics"
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "api_instance_profile" {
  name = "pulsewatch-api-instance-profile"
  role = aws_iam_role.api_instance_role.name
}

# IAM Role & Instance Profile for Worker EC2 Instances
resource "aws_iam_role" "worker_instance_role" {
  name = "pulsewatch-worker-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "worker_ssm_core" {
  role       = aws_iam_role.worker_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "worker_custom_policy" {
  name = "pulsewatch-worker-policy"
  role = aws_iam_role.worker_instance_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMParametersAccess"
        Effect = "Allow"
        Action = [
          "ssm:GetParameter",
          "ssm:GetParameters",
          "ssm:GetParametersByPath"
        ]
        Resource = "arn:aws:ssm:${var.aws_region}:${var.account_id}:parameter/pulsewatch/*"
      },
      {
        Sid    = "KMSDecryptAccess"
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:DescribeKey"
        ]
        Resource = aws_kms_key.pulsewatch.arn
      },
      {
        Sid    = "SQSPollAccess"
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl"
        ]
        Resource = "arn:aws:sqs:${var.aws_region}:${var.account_id}:pulsewatch-*"
      },
      {
        Sid    = "DynamoDBWriteAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DescribeTable"
        ]
        Resource = "arn:aws:dynamodb:${var.aws_region}:${var.account_id}:table/pulsewatch-*"
      },
      {
        Sid    = "StepFunctionsTaskCallback"
        Effect = "Allow"
        Action = [
          "states:SendTaskSuccess",
          "states:SendTaskFailure"
        ]
        Resource = "*"
      },
      {
        Sid    = "S3ArtifactsAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject"
        ]
        Resource = "arn:aws:s3:::pulsewatch-*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "worker_instance_profile" {
  name = "pulsewatch-worker-instance-profile"
  role = aws_iam_role.worker_instance_role.name
}

# IAM Role & Instance Profile for Victim EC2 Host
resource "aws_iam_role" "victim_instance_role" {
  name = "pulsewatch-victim-instance-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "victim_ssm_core" {
  role       = aws_iam_role.victim_instance_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "victim_instance_profile" {
  name = "pulsewatch-victim-instance-profile"
  role = aws_iam_role.victim_instance_role.name
}

output "kms_key_arn" { value = aws_kms_key.pulsewatch.arn }
output "kms_key_id" { value = aws_kms_key.pulsewatch.key_id }
output "api_instance_profile_name" { value = aws_iam_instance_profile.api_instance_profile.name }
output "worker_instance_profile_name" { value = aws_iam_instance_profile.worker_instance_profile.name }
output "victim_instance_profile_name" { value = aws_iam_instance_profile.victim_instance_profile.name }

# -------------------------------------------------------------
# IAM Groups: Developers & Read-Only with Least-Privilege Policies
# -------------------------------------------------------------

# 1. Developer Group (Access to PulseWatch resources & Session Manager)
resource "aws_iam_group" "developers" {
  name = "pulsewatch-developers"
}

resource "aws_iam_group_policy" "developers" {
  name  = "pulsewatch-developer-policy"
  group = aws_iam_group.developers.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "SSMSessionManagerConnect"
        Effect = "Allow"
        Action = [
          "ssm:StartSession",
          "ssm:SendCommand",
          "ssm:DescribeInstanceInformation",
          "ssm:GetConnectionStatus"
        ]
        Resource = "*"
      },
      {
        Sid    = "PulseWatchResourceManagement"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "ec2:StartInstances",
          "ec2:StopInstances",
          "ec2:RebootInstances",
          "autoscaling:Describe*",
          "autoscaling:SetDesiredCapacity",
          "autoscaling:UpdateAutoScalingGroup",
          "rds:Describe*",
          "rds:RebootDBInstance",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "sqs:GetQueueAttributes",
          "sqs:GetQueueUrl",
          "sqs:ReceiveMessage",
          "sqs:SendMessage",
          "sns:Publish",
          "states:Describe*",
          "states:ListExecutions",
          "states:StartExecution",
          "cloudwatch:Get*",
          "cloudwatch:List*",
          "logs:Get*",
          "logs:Describe*",
          "logs:FilterLogEvents"
        ]
        Resource = "*"
      }
    ]
  })
}

# 2. Read-Only Group (Inspection only; zero modifications)
resource "aws_iam_group" "readonly" {
  name = "pulsewatch-readonly"
}

resource "aws_iam_group_policy" "readonly" {
  name  = "pulsewatch-readonly-policy"
  group = aws_iam_group.readonly.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadOnlyAccess"
        Effect = "Allow"
        Action = [
          "ec2:Describe*",
          "autoscaling:Describe*",
          "rds:Describe*",
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:Query",
          "sqs:GetQueueAttributes",
          "sqs:ListQueues",
          "sns:ListTopics",
          "states:Describe*",
          "states:List*",
          "cloudwatch:Describe*",
          "cloudwatch:Get*",
          "cloudwatch:List*",
          "logs:Describe*",
          "logs:Get*",
          "logs:FilterLogEvents",
          "s3:ListBucket",
          "s3:GetObject"
        ]
        Resource = "*"
      }
    ]
  })
}
