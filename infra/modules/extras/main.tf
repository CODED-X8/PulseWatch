# ==============================================================================
# PulseWatch Demo Extras Module (Stage 6)
# ==============================================================================
# All resources here are toggle-able and OFF by default.
# Used for live demonstrations during viva, then destroyed to conserve credits.
# ==============================================================================

variable "aws_region" { type = string }
variable "account_id" { type = string }
variable "environment" { type = string }
variable "main_vpc_id" { type = string }
variable "public_subnet_ids" { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "alb_arn" { type = string }
variable "rds_instance_id" { type = string }
variable "kms_key_arn" { type = string }

variable "enable_waf" {
  type        = bool
  default     = false
  description = "Attach AWS WAFv2 Web ACL to ALB with AWS Managed Common Rule Set"
}

variable "enable_replica" {
  type        = bool
  default     = false
  description = "Provision an RDS PostgreSQL Read Replica (db.t4g.micro)"
}

variable "enable_nat" {
  type        = bool
  default     = false
  description = "Provision an Elastic IP and NAT Gateway in public subnet"
}

# ------------------------------------------------------------------------------
# 1. AWS WAFv2: Application Security & Layer-7 Protection
# ------------------------------------------------------------------------------
resource "aws_wafv2_web_acl" "alb_waf" {
  count       = var.enable_waf && var.alb_arn != "" ? 1 : 0
  name        = "pulsewatch-alb-waf"
  description = "WAFv2 Web ACL protecting the Application Load Balancer"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1

    override_action {
      none {}
    }

    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "PulseWatchCommonRulesMetric"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "PulseWatchWebAclMetric"
    sampled_requests_enabled   = true
  }

  tags = { Name = "pulsewatch-alb-waf" }
}

resource "aws_wafv2_web_acl_association" "alb_assoc" {
  count        = var.enable_waf && var.alb_arn != "" ? 1 : 0
  resource_arn = var.alb_arn
  web_acl_arn  = aws_wafv2_web_acl.alb_waf[0].arn
}

# ------------------------------------------------------------------------------
# 2. RDS Read Replica (Read Scaling & Disaster Recovery)
# ------------------------------------------------------------------------------
resource "aws_db_instance" "replica" {
  count                      = var.enable_replica ? 1 : 0
  identifier                 = "pulsewatch-db-replica"
  replicate_source_db        = var.rds_instance_id
  instance_class             = "db.t4g.micro"
  auto_minor_version_upgrade = true
  skip_final_snapshot        = true
  publicly_accessible        = false
  storage_encrypted          = true
  kms_key_id                 = var.kms_key_arn

  tags = {
    Name = "pulsewatch-db-replica"
    Role = "ReadReplica"
  }
}

# ------------------------------------------------------------------------------
# 3. NAT Gateway Demo (Private Outbound Egress)
# ------------------------------------------------------------------------------
resource "aws_eip" "nat" {
  count  = var.enable_nat ? 1 : 0
  domain = "vpc"
  tags   = { Name = "pulsewatch-nat-eip" }
}

resource "aws_nat_gateway" "nat" {
  count         = var.enable_nat ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = var.public_subnet_ids[0]

  tags = { Name = "pulsewatch-nat-gw" }
}

# ------------------------------------------------------------------------------
# Outputs
# ------------------------------------------------------------------------------
output "waf_acl_arn" {
  value = var.enable_waf && length(aws_wafv2_web_acl.alb_waf) > 0 ? aws_wafv2_web_acl.alb_waf[0].arn : ""
}

output "replica_endpoint" {
  value = var.enable_replica && length(aws_db_instance.replica) > 0 ? aws_db_instance.replica[0].endpoint : ""
}

output "nat_gateway_ip" {
  value = var.enable_nat && length(aws_eip.nat) > 0 ? aws_eip.nat[0].public_ip : ""
}
