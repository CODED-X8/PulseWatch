variable "vpc_cidr" { type = string }
variable "availability_zones" { type = list(string) }
variable "environment" { type = string }
variable "enable_nat" { type = bool }
variable "my_ip_cidr" { 
  type    = string 
  default = "0.0.0.0/0" 
}

# 1. Main VPC
resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "pulsewatch-main-vpc"
  }
}

# Internet Gateway
resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags = { Name = "pulsewatch-main-igw" }
}

# Public Subnets (2 AZs: for ALB, API ASG, Worker ASG)
resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 1)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name = "pulsewatch-public-subnet-${count.index + 1}-${var.availability_zones[count.index]}"
  }
}

# Private Subnets (2 AZs: strictly for RDS PostgreSQL)
resource "aws_subnet" "private" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index + 11)
  availability_zone       = var.availability_zones[count.index]
  map_public_ip_on_launch = false

  tags = {
    Name = "pulsewatch-private-db-subnet-${count.index + 1}-${var.availability_zones[count.index]}"
  }
}

# Public Route Table
resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "pulsewatch-public-rt" }
}

resource "aws_route" "public_internet" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Private DB Route Table (No internet route - zero NAT gateway charges)
resource "aws_route_table" "private" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "pulsewatch-private-db-rt" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

# S3 Gateway Endpoint (Zero data egress cost for S3 artifact/logs)
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.ap-south-1.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id, aws_route_table.private.id]

  tags = { Name = "pulsewatch-s3-endpoint" }
}

# CloudFront Origin Facing Managed Prefix List
data "aws_ec2_managed_prefix_list" "cloudfront" {
  name = "com.amazonaws.global.cloudfront.origin-facing"
}

# Security Group: Application Load Balancer
resource "aws_security_group" "alb" {
  name        = "pulsewatch-alb-sg"
  description = "Ingress from CloudFront origin-facing prefix list only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "HTTP from CloudFront"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    prefix_list_ids = [data.aws_ec2_managed_prefix_list.cloudfront.id]
  }

  # Also allow HTTP from specified CIDR as fallback while CloudFront verification is pending
  ingress {
    description = "HTTP direct fallback restricted by my_ip_cidr"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = [var.my_ip_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "pulsewatch-alb-sg" }
}

# Security Group: API Instances (Receives traffic ONLY from ALB)
resource "aws_security_group" "api" {
  name        = "pulsewatch-api-sg"
  description = "Ingress from ALB on port 8000 only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "FastAPI traffic from ALB"
    from_port       = 8000
    to_port         = 8000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "pulsewatch-api-sg" }
}

# Security Group: Worker Instances (Zero inbound ports open!)
resource "aws_security_group" "worker" {
  name        = "pulsewatch-worker-sg"
  description = "Zero inbound ports; egress for HTTP/HTTPS synthetic probes and AWS APIs"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "pulsewatch-worker-sg" }
}

# Security Group: RDS PostgreSQL (Receives traffic ONLY from API instances)
resource "aws_security_group" "db" {
  name        = "pulsewatch-rds-sg"
  description = "Inbound PostgreSQL from API instances only"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "PostgreSQL from API SG"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.api.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "pulsewatch-rds-sg" }
}

output "main_vpc_id" { value = aws_vpc.main.id }
output "public_subnet_ids" { value = aws_subnet.public[*].id }
output "private_subnet_ids" { value = aws_subnet.private[*].id }
output "public_route_table_id" { value = aws_route_table.public.id }
output "alb_sg_id" { value = aws_security_group.alb.id }
output "api_sg_id" { value = aws_security_group.api.id }
output "worker_sg_id" { value = aws_security_group.worker.id }
output "db_sg_id" { value = aws_security_group.db.id }
