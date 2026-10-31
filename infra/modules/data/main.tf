variable "environment" { type = string }
variable "private_subnet_ids" { type = list(string) }
variable "db_sg_id" { type = string }
variable "kms_key_arn" { type = string }
variable "db_password" { type = string }

# -------------------------------------------------------------
# Amazon RDS PostgreSQL: Smallest class (db.t4g.micro), Single-AZ, Private Subnets
# -------------------------------------------------------------

resource "aws_db_subnet_group" "pulsewatch" {
  name        = "pulsewatch-db-subnet-group"
  description = "Private database subnets for PulseWatch RDS PostgreSQL"
  subnet_ids  = var.private_subnet_ids

  tags = { Name = "pulsewatch-db-subnet-group" }
}

resource "aws_db_instance" "pulsewatch" {
  identifier                  = "pulsewatch-db"
  engine                      = "postgres"
  engine_version              = "15.13"
  instance_class              = "db.t4g.micro"
  allocated_storage           = 20
  max_allocated_storage       = 30
  storage_type                = "gp3"
  storage_encrypted           = true
  kms_key_id                  = var.kms_key_arn
  multi_az                    = false
  publicly_accessible        = false
  db_subnet_group_name        = aws_db_subnet_group.pulsewatch.name
  vpc_security_group_ids      = [var.db_sg_id]
  db_name                     = "pulsewatch"
  username                    = "pulsewatch_admin"
  password                    = var.db_password
  skip_final_snapshot         = true
  backup_retention_period     = 1
  auto_minor_version_upgrade  = true
  deletion_protection         = false

  tags = { Name = "pulsewatch-rds-postgres" }
}

# Write DB Connection Info to SSM Parameter Store (SecureString for password)
resource "aws_ssm_parameter" "db_host" {
  name        = "/pulsewatch/db_host"
  description = "RDS PostgreSQL endpoint hostname"
  type        = "String"
  value       = aws_db_instance.pulsewatch.address
  overwrite   = true
}

resource "aws_ssm_parameter" "db_port" {
  name        = "/pulsewatch/db_port"
  description = "RDS PostgreSQL port"
  type        = "String"
  value       = "5432"
  overwrite   = true
}

resource "aws_ssm_parameter" "db_name" {
  name        = "/pulsewatch/db_name"
  description = "RDS PostgreSQL database name"
  type        = "String"
  value       = "pulsewatch"
  overwrite   = true
}

resource "aws_ssm_parameter" "db_user" {
  name        = "/pulsewatch/db_user"
  description = "RDS PostgreSQL master username"
  type        = "String"
  value       = "pulsewatch_admin"
  overwrite   = true
}

resource "aws_ssm_parameter" "db_password" {
  name        = "/pulsewatch/db_password"
  description = "RDS PostgreSQL master password (KMS encrypted)"
  type        = "SecureString"
  key_id      = var.kms_key_arn
  value       = var.db_password
  overwrite   = true
}

# -------------------------------------------------------------
# Amazon DynamoDB: On-Demand, TTL, Streams
# -------------------------------------------------------------

resource "aws_dynamodb_table" "checks" {
  name             = "pulsewatch-checks"
  billing_mode     = "PAY_PER_REQUEST"
  hash_key         = "monitor_id"
  range_key        = "ts"
  stream_enabled   = true
  stream_view_type = "NEW_IMAGE"

  attribute {
    name = "monitor_id"
    type = "S"
  }

  attribute {
    name = "ts"
    type = "N"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }

  point_in_time_recovery {
    enabled = false
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = { Name = "pulsewatch-checks" }
}

resource "aws_dynamodb_table" "incidents" {
  name         = "pulsewatch-incidents"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "monitor_id"
  range_key    = "item_id"

  attribute {
    name = "monitor_id"
    type = "S"
  }

  attribute {
    name = "item_id"
    type = "S"
  }

  attribute {
    name = "user_id"
    type = "S"
  }

  attribute {
    name = "startedAt"
    type = "S"
  }

  global_secondary_index {
    name            = "by_user"
    hash_key        = "user_id"
    range_key       = "startedAt"
    projection_type = "ALL"
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }

  tags = { Name = "pulsewatch-incidents" }
}

output "rds_endpoint" { value = aws_db_instance.pulsewatch.endpoint }
output "rds_address" { value = aws_db_instance.pulsewatch.address }
output "rds_instance_id" { value = aws_db_instance.pulsewatch.identifier }
output "dynamodb_checks_table" { value = aws_dynamodb_table.checks.name }
output "dynamodb_checks_stream_arn" { value = aws_dynamodb_table.checks.stream_arn }
output "dynamodb_incidents_table" { value = aws_dynamodb_table.incidents.name }
