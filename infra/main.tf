terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  backend "s3" {
    bucket       = "pulsewatch-tfstate-826903518995"
    key          = "pulsewatch/terraform.tfstate"
    region       = "ap-south-1"
    profile      = "pulsewatch"
    use_lockfile = true
  }
}

provider "aws" {
  region  = var.aws_region
  profile = "pulsewatch"
  default_tags {
    tags = {
      Project     = "PulseWatch"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}

data "aws_caller_identity" "current" {}
data "aws_availability_zones" "available" {
  state = "available"
}

# Generate cryptographically secure random secrets locally (never committed)
resource "random_password" "jwt_secret" {
  length  = 48
  special = false
}

resource "random_password" "origin_verify_secret" {
  length  = 32
  special = false
}

# 1. Security Module: KMS Key, SSM Parameters, IAM Roles & Instance Profiles
module "security" {
  source               = "./modules/security"
  aws_region           = var.aws_region
  account_id           = data.aws_caller_identity.current.account_id
  environment          = var.environment
  admin_email          = var.admin_email
  alert_email          = var.alert_email
  jwt_secret           = random_password.jwt_secret.result
  origin_verify_secret = random_password.origin_verify_secret.result
}

# 2. Network Module: Main VPC (2 AZs), Public/Private Subnets, S3 Endpoint, Security Groups
module "network" {
  source             = "./modules/network"
  vpc_cidr           = "10.0.0.0/16"
  availability_zones = slice(data.aws_availability_zones.available.names, 0, 2)
  environment        = var.environment
  enable_nat         = var.enable_nat
  my_ip_cidr         = var.my_ip_cidr
}

# 3. Victim Module: Victim VPC, Nginx/Postgres Host, VPC Peering to Main VPC
module "victim" {
  source             = "./modules/victim"
  victim_cidr        = "10.1.0.0/16"
  availability_zone  = data.aws_availability_zones.available.names[0]
  environment        = var.environment
  main_vpc_id        = module.network.main_vpc_id
  main_route_table_id= module.network.public_route_table_id
  worker_sg_id       = module.network.worker_sg_id
}


# -------------------------------------------------------------
# Stage 2 Additions: Data & Messaging
# -------------------------------------------------------------

resource "random_password" "db_password" {
  length  = 28
  special = false
}

module "data" {
  source             = "./modules/data"
  environment        = var.environment
  private_subnet_ids = module.network.private_subnet_ids
  db_sg_id           = module.network.db_sg_id
  kms_key_arn        = module.security.kms_key_arn
  db_password        = random_password.db_password.result
}

module "messaging" {
  source      = "./modules/messaging"
  alert_email = var.alert_email
  kms_key_arn = module.security.kms_key_arn
}

# -------------------------------------------------------------
# Stages 3 & 4: Compute & Edge Modules
# -------------------------------------------------------------

module "compute" {
  source               = "./modules/compute"
  aws_region           = var.aws_region
  account_id           = data.aws_caller_identity.current.account_id
  environment          = var.environment
  main_vpc_id          = module.network.main_vpc_id
  public_subnet_ids    = module.network.public_subnet_ids
  alb_sg_id            = module.network.alb_sg_id
  api_sg_id            = module.network.api_sg_id
  worker_sg_id         = module.network.worker_sg_id
  kms_key_arn          = module.security.kms_key_arn
  check_queue_url      = module.messaging.check_queue_id
  check_queue_arn      = module.messaging.check_queue_arn
  origin_verify_secret = random_password.origin_verify_secret.result
  alb_enabled          = var.alb_enabled
}

module "edge" {
  source               = "./modules/edge"
  account_id           = data.aws_caller_identity.current.account_id
  alb_dns_name         = module.compute.alb_dns_name
  alb_enabled          = var.alb_enabled
  origin_verify_secret = random_password.origin_verify_secret.result
}

# -------------------------------------------------------------
# Stage 5: Workflow (Step Functions + Lambda) & Governance (CloudWatch + CloudTrail + Config)
# -------------------------------------------------------------

module "workflow" {
  source               = "./modules/workflow"
  aws_region           = var.aws_region
  account_id           = data.aws_caller_identity.current.account_id
  environment          = var.environment
  checks_stream_arn    = module.data.dynamodb_checks_stream_arn
  incidents_table_name = module.data.dynamodb_incidents_table
  check_queue_url       = module.messaging.check_queue_id
  check_queue_arn       = module.messaging.check_queue_arn
  alerts_topic_arn      = module.messaging.alerts_topic_arn
  kms_key_arn           = module.security.kms_key_arn
  recheck_wait_seconds  = var.recheck_wait_seconds
  recheck_count         = var.recheck_count
  recovery_poll_seconds = var.recovery_poll_seconds
}

module "governance" {
  source           = "./modules/governance"
  aws_region       = var.aws_region
  account_id       = data.aws_caller_identity.current.account_id
  environment      = var.environment
  alert_email      = var.alert_email
  alerts_topic_arn = module.messaging.alerts_topic_arn
  kms_key_arn      = module.security.kms_key_arn
  alb_arn          = module.compute.alb_arn
  alb_enabled      = var.alb_enabled
}

# -------------------------------------------------------------
# Stage 6: Demo Extras Module (Toggle-able, OFF by default)
# -------------------------------------------------------------

module "extras" {
  source             = "./modules/extras"
  aws_region         = var.aws_region
  account_id         = data.aws_caller_identity.current.account_id
  environment        = var.environment
  main_vpc_id        = module.network.main_vpc_id
  public_subnet_ids  = module.network.public_subnet_ids
  private_subnet_ids = module.network.private_subnet_ids
  alb_arn            = module.compute.alb_arn
  rds_instance_id    = module.data.rds_instance_id
  kms_key_arn        = module.security.kms_key_arn
  enable_waf         = var.enable_waf
  enable_replica     = var.enable_replica
  enable_nat         = var.enable_nat
}
