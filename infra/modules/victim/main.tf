variable "victim_cidr" { type = string }
variable "availability_zone" { type = string }
variable "environment" { type = string }
variable "main_vpc_id" { type = string }
variable "main_route_table_id" { type = string }
variable "worker_sg_id" { type = string }

# 1. Victim Standalone VPC
resource "aws_vpc" "victim" {
  cidr_block           = var.victim_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true
  tags                 = { Name = "pulsewatch-victim-vpc" }
}

resource "aws_internet_gateway" "victim" {
  vpc_id = aws_vpc.victim.id
  tags   = { Name = "pulsewatch-victim-igw" }
}

resource "aws_subnet" "victim" {
  vpc_id                  = aws_vpc.victim.id
  cidr_block              = cidrsubnet(var.victim_cidr, 8, 1)
  availability_zone       = var.availability_zone
  map_public_ip_on_launch = true
  tags                    = { Name = "pulsewatch-victim-subnet" }
}

# 2. VPC Peering between Main VPC and Victim VPC
resource "aws_vpc_peering_connection" "main_to_victim" {
  vpc_id      = var.main_vpc_id
  peer_vpc_id = aws_vpc.victim.id
  auto_accept = true

  tags = { Name = "pulsewatch-main-to-victim-peering" }
}

# Route in Main VPC pointing to Victim CIDR
resource "aws_route" "main_to_victim" {
  route_table_id            = var.main_route_table_id
  destination_cidr_block    = var.victim_cidr
  vpc_peering_connection_id = aws_vpc_peering_connection.main_to_victim.id
}

# Route table in Victim VPC
resource "aws_route_table" "victim" {
  vpc_id = aws_vpc.victim.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.victim.id
  }

  route {
    cidr_block                = "10.0.0.0/16"
    vpc_peering_connection_id = aws_vpc_peering_connection.main_to_victim.id
  }

  tags = { Name = "pulsewatch-victim-rt" }
}

resource "aws_route_table_association" "victim" {
  subnet_id      = aws_subnet.victim.id
  route_table_id = aws_route_table.victim.id
}

# Security Group for Victim Host
resource "aws_security_group" "victim" {
  name        = "pulsewatch-victim-sg"
  description = "Allows HTTP/Postgres probes from Worker SG in Main VPC"
  vpc_id      = aws_vpc.victim.id

  ingress {
    description = "HTTP from Main VPC"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  ingress {
    description = "PostgreSQL from Main VPC (for DMS demo)"
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/16"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "pulsewatch-victim-sg" }
}

# Amazon Linux 2023 AMI lookup
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

# Victim Host EC2 Instance (Runs Nginx and Local Postgres)
resource "aws_instance" "victim" {
  ami                  = data.aws_ami.al2023.id
  instance_type        = "t3.micro"
  subnet_id            = aws_subnet.victim.id
  vpc_security_group_ids = [aws_security_group.victim.id]
  iam_instance_profile = "pulsewatch-victim-instance-profile"

  metadata_options {
    http_endpoint = "enabled"
    http_tokens   = "required" # IMDSv2
  }

  root_block_device {
    volume_size = 10
    encrypted   = true
  }

  user_data = <<-EOF
              #!/bin/bash
              dnf update -y
              dnf install -y nginx postgresql15-server postgresql15
              
              # Setup standard Nginx page
              echo '<!DOCTYPE html><html><head><title>Victim Service</title></head><body><h1>Victim Enterprise Portal</h1><p>Status: OPERATIONAL</p></body></html>' > /usr/share/nginx/html/index.html
              echo '{"status":"UP","service":"victim-core","version":"1.0.4"}' > /usr/share/nginx/html/healthz
              
              systemctl enable nginx
              systemctl start nginx

              # Setup local postgres for DMS demo
              postgresql-setup --initdb
              systemctl enable postgresql
              systemctl start postgresql
              EOF

  tags = {
    Name = "pulsewatch-victim-host"
  }
}

output "victim_vpc_id" { value = aws_vpc.victim.id }
output "victim_private_ip" { value = aws_instance.victim.private_ip }
output "victim_instance_id" { value = aws_instance.victim.id }
