variable "aws_region" {
  type        = string
  default     = "ap-south-1"
  description = "Target AWS Region"
}

variable "environment" {
  type        = string
  default     = "prod"
  description = "Deployment environment name"
}

variable "admin_email" {
  type        = string
  description = "Admin user email address (singhayushbr@gmail.com)"
}

variable "alert_email" {
  type        = string
  description = "Incident alert email address (anandayush798@gmail.com)"
}

variable "enable_nat" {
  type        = bool
  default     = false
  description = "Toggle NAT Gateway (false by default to prevent hourly billing)"
}

variable "enable_multiaz" {
  type        = bool
  default     = false
  description = "Toggle RDS Multi-AZ (demo-extras only)"
}

variable "enable_waf" {
  type        = bool
  default     = false
  description = "Toggle AWS WAFv2 (demo-extras only)"
}

variable "enable_replica" {
  type        = bool
  default     = false
  description = "Toggle RDS PostgreSQL Read Replica (demo-extras only)"
}

variable "alb_enabled" {
  type        = bool
  default     = true
  description = "Toggle ALB creation (set false in deep pause mode to eliminate ALB hourly billing)"
}

variable "enable_cloudfront" {
  type        = bool
  default     = false
  description = "Toggle CloudFront distribution creation (set true after AWS account verification)"
}

variable "my_ip_cidr" {
  type        = string
  default     = "0.0.0.0/0"
  description = "CIDR block permitted to access ALB directly while CloudFront verification is pending"
}

variable "recheck_wait_seconds" {
  type        = number
  default     = 5
  description = "Wait time in seconds before executing outage recheck probe"
}

variable "recheck_count" {
  type        = number
  default     = 1
  description = "Number of re-check attempts by the worker fleet before confirming outage"
}

variable "recovery_poll_seconds" {
  type        = number
  default     = 15
  description = "Polling interval in seconds between recovery checks"
}
