variable "aws_region" { type = string }
variable "account_id" { type = string }
variable "environment" { type = string }
variable "main_vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "alb_sg_id" { type = string }
variable "api_sg_id" { type = string }
variable "worker_sg_id" { type = string }
variable "kms_key_arn" { type = string }
variable "check_queue_url" { type = string }
variable "check_queue_arn" { type = string }
variable "origin_verify_secret" { type = string }
variable "alb_enabled" { 
  type    = bool 
  default = true 
}

# S3 Artifacts Bucket for Backend code packages & reports
resource "aws_s3_bucket" "artifacts" {
  bucket        = "pulsewatch-artifacts-${var.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "artifacts" {
  bucket                  = aws_s3_bucket.artifacts.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "artifacts" {
  bucket = aws_s3_bucket.artifacts.id

  rule {
    id     = "artifacts-cleanup"
    status = "Enabled"

    filter {}

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

# Dedicated S3 Bucket for CSV Incident Reports
resource "aws_s3_bucket" "reports" {
  bucket        = "pulsewatch-reports-${var.account_id}"
  force_destroy = true

  tags = {
    Name    = "pulsewatch-reports"
    Project = "PulseWatch"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
  }
}

resource "aws_s3_bucket_public_access_block" "reports" {
  bucket                  = aws_s3_bucket.reports.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "reports" {
  bucket = aws_s3_bucket.reports.id

  rule {
    id     = "reports-tiered-retention"
    status = "Enabled"

    filter {}

    transition {
      days          = 30
      storage_class = "STANDARD_IA"
    }

    transition {
      days          = 90
      storage_class = "GLACIER"
    }

    expiration {
      days = 365
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_s3_object" "backend_code" {
  bucket = aws_s3_bucket.artifacts.id
  key    = "backend_package.zip"
  source = "${path.root}/backend_package.zip"
  etag   = filemd5("${path.root}/backend_package.zip")
}

# -------------------------------------------------------------
# Application Load Balancer (ALB) - Only created when alb_enabled = true
# -------------------------------------------------------------

resource "aws_lb" "api" {
  count              = var.alb_enabled ? 1 : 0
  name               = "pulsewatch-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [var.alb_sg_id]
  subnets            = var.public_subnet_ids

  drop_invalid_header_fields = true
  enable_deletion_protection = false

  tags = { Name = "pulsewatch-alb" }
}

resource "aws_lb_target_group" "api" {
  count                = var.alb_enabled ? 1 : 0
  name                 = "pulsewatch-api-tg"
  port                 = 8000
  protocol             = "HTTP"
  vpc_id               = var.main_vpc_id
  target_type          = "instance"
  deregistration_delay = 15

  health_check {
    enabled             = true
    path                = "/api/health"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 15
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 2
  }

  tags = { Name = "pulsewatch-api-tg" }
}

# ALB Listener enforcing Secret Origin Header Check
resource "aws_lb_listener" "http" {
  count             = var.alb_enabled ? 1 : 0
  load_balancer_arn = aws_lb.api[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\": \"Direct ALB access forbidden. Request must transit CloudFront with valid origin verification header.\"}"
      status_code  = "403"
    }
  }
}

resource "aws_lb_listener_rule" "forward_to_api" {
  count        = var.alb_enabled ? 1 : 0
  listener_arn = aws_lb_listener.http[0].arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }

  condition {
    http_header {
      http_header_name = "X-PulseWatch-Origin-Verify"
      values           = [var.origin_verify_secret]
    }
  }
}

# Amazon Linux 2023 AMI
data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-2023.*-x86_64"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
}

# -------------------------------------------------------------
# API Auto Scaling Group & Launch Template
# -------------------------------------------------------------

resource "aws_launch_template" "api" {
  name_prefix   = "pulsewatch-api-lt-"
  image_id      = data.aws_ami.al2023.id
  instance_type = "t3.micro"

  iam_instance_profile {
    name = "pulsewatch-api-instance-profile"
  }

  vpc_security_group_ids = [var.api_sg_id]

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = 10
      volume_type = "gp3"
      encrypted   = true
    }
  }

  user_data = base64encode(<<-EOF
              #!/bin/bash
              dnf update -y
              dnf install -y python3-pip unzip
              mkdir -p /opt/pulsewatch
              cd /opt/pulsewatch

              aws s3 cp s3://${aws_s3_bucket.artifacts.id}/backend_package.zip .
              unzip -o backend_package.zip

              python3 -m venv /opt/pulsewatch/venv
              /opt/pulsewatch/venv/bin/pip install --upgrade pip
              /opt/pulsewatch/venv/bin/pip install -r requirements.txt

              cat << 'SVC' > /etc/systemd/system/pulsewatch-api.service
              [Unit]
              Description=PulseWatch FastAPI Service
              After=network.target

              [Service]
              Type=simple
              User=root
              WorkingDirectory=/opt/pulsewatch
              Environment="AWS_REGION=${var.aws_region}"
              Environment="CHECK_QUEUE_URL=${var.check_queue_url}"
              Environment="REPORTS_BUCKET=${aws_s3_bucket.reports.id}"
              ExecStart=/opt/pulsewatch/venv/bin/uvicorn app:app --host 0.0.0.0 --port 8000
              Restart=always
              RestartSec=5

              [Install]
              WantedBy=multi-user.target
              SVC

              systemctl daemon-reload
              systemctl enable pulsewatch-api
              systemctl start pulsewatch-api
              EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name    = "pulsewatch-api-instance"
      Project = "PulseWatch"
    }
  }
}

resource "aws_autoscaling_group" "api" {
  name_prefix         = "pulsewatch-api-asg-"
  min_size            = 1
  max_size            = 2
  desired_capacity    = 1
  vpc_zone_identifier = var.public_subnet_ids

  target_group_arns = var.alb_enabled ? [aws_lb_target_group.api[0].arn] : []

  launch_template {
    id      = aws_launch_template.api.id
    version = "$Latest"
  }

  instance_refresh {
    strategy = "Rolling"
  }

  tag {
    key                 = "Project"
    value               = "PulseWatch"
    propagate_at_launch = true
  }
}

# -------------------------------------------------------------
# Worker Auto Scaling Group & Launch Template with Step Scaling
# -------------------------------------------------------------

resource "aws_launch_template" "worker" {
  name_prefix   = "pulsewatch-worker-lt-"
  image_id      = data.aws_ami.al2023.id
  instance_type = "t3.micro"

  iam_instance_profile {
    name = "pulsewatch-worker-instance-profile"
  }

  vpc_security_group_ids = [var.worker_sg_id]

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2
  }

  block_device_mappings {
    device_name = "/dev/xvda"
    ebs {
      volume_size = 10
      volume_type = "gp3"
      encrypted   = true
    }
  }

  user_data = base64encode(<<-EOF
              #!/bin/bash
              dnf update -y
              dnf install -y python3-pip unzip
              mkdir -p /opt/pulsewatch
              cd /opt/pulsewatch

              aws s3 cp s3://${aws_s3_bucket.artifacts.id}/backend_package.zip .
              unzip -o backend_package.zip

              python3 -m venv /opt/pulsewatch/venv
              /opt/pulsewatch/venv/bin/pip install --upgrade pip
              /opt/pulsewatch/venv/bin/pip install -r requirements.txt

              cat << 'SVC' > /etc/systemd/system/pulsewatch-worker.service
              [Unit]
              Description=PulseWatch SQS Worker Service
              After=network.target

              [Service]
              Type=simple
              User=root
              WorkingDirectory=/opt/pulsewatch
              Environment="AWS_REGION=${var.aws_region}"
              Environment="CHECK_QUEUE_URL=${var.check_queue_url}"
              ExecStart=/opt/pulsewatch/venv/bin/python worker.py
              Restart=always
              RestartSec=5

              [Install]
              WantedBy=multi-user.target
              SVC

              systemctl daemon-reload
              systemctl enable pulsewatch-worker
              systemctl start pulsewatch-worker
              EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name    = "pulsewatch-worker-instance"
      Project = "PulseWatch"
    }
  }
}

resource "aws_autoscaling_group" "worker" {
  name_prefix         = "pulsewatch-worker-asg-"
  min_size            = 1
  max_size            = 3
  desired_capacity    = 1
  vpc_zone_identifier = var.public_subnet_ids

  launch_template {
    id      = aws_launch_template.worker.id
    version = "$Latest"
  }

  tag {
    key                 = "Project"
    value               = "PulseWatch"
    propagate_at_launch = true
  }
}

# Step Scaling Policy based on SQS Queue Depth
resource "aws_autoscaling_policy" "worker_scale_out" {
  name                   = "pulsewatch-worker-sqs-scale-out"
  scaling_adjustment     = 1
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 60
  autoscaling_group_name = aws_autoscaling_group.worker.name
}

resource "aws_cloudwatch_metric_alarm" "sqs_high_queue" {
  alarm_name          = "pulsewatch-sqs-queue-depth-high"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 25
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_autoscaling_policy.worker_scale_out.arn]

  dimensions = {
    QueueName = "pulsewatch-check-queue"
  }
}

resource "aws_autoscaling_policy" "worker_scale_in" {
  name                   = "pulsewatch-worker-sqs-scale-in"
  scaling_adjustment     = -1
  adjustment_type        = "ChangeInCapacity"
  cooldown               = 120
  autoscaling_group_name = aws_autoscaling_group.worker.name
}

resource "aws_cloudwatch_metric_alarm" "sqs_low_queue" {
  alarm_name          = "pulsewatch-sqs-queue-depth-low"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 2
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Average"
  threshold           = 5
  treat_missing_data  = "notBreaching"
  alarm_actions       = [aws_autoscaling_policy.worker_scale_in.arn]

  dimensions = {
    QueueName = "pulsewatch-check-queue"
  }
}

output "alb_dns_name" { value = var.alb_enabled ? aws_lb.api[0].dns_name : "" }
output "alb_arn" { value = var.alb_enabled ? aws_lb.api[0].arn : "" }
output "artifacts_bucket" { value = aws_s3_bucket.artifacts.id }
output "reports_bucket_name" { value = aws_s3_bucket.reports.id }
output "api_asg_name" { value = aws_autoscaling_group.api.name }
output "worker_asg_name" { value = aws_autoscaling_group.worker.name }
