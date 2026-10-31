output "kms_key_arn" {
  value = module.security.kms_key_arn
}

output "main_vpc_id" {
  value = module.network.main_vpc_id
}

output "public_subnet_ids" {
  value = module.network.public_subnet_ids
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "alb_sg_id" {
  value = module.network.alb_sg_id
}

output "api_sg_id" {
  value = module.network.api_sg_id
}

output "worker_sg_id" {
  value = module.network.worker_sg_id
}

output "db_sg_id" {
  value = module.network.db_sg_id
}

output "victim_private_ip" {
  value = module.victim.victim_private_ip
}

output "rds_endpoint" {
  value = module.data.rds_endpoint
}

output "dynamodb_checks_table" {
  value = module.data.dynamodb_checks_table
}

output "dynamodb_incidents_table" {
  value = module.data.dynamodb_incidents_table
}

output "sqs_check_queue_id" {
  value = module.messaging.check_queue_id
}

output "sns_alerts_topic_arn" {
  value = module.messaging.alerts_topic_arn
}

output "alb_dns_name" {
  value = module.compute.alb_dns_name
}

output "cloudfront_domain_name" {
  value = module.edge.cloudfront_domain_name
}

output "cloudfront_id" {
  value = module.edge.cloudfront_id
}

output "frontend_bucket_name" {
  value = module.edge.frontend_bucket_name
}

output "s3_website_endpoint" {
  value = module.edge.s3_website_endpoint
}

output "state_machine_arn" {
  value = module.workflow.state_machine_arn
}

output "cloudwatch_dashboard_name" {
  value = module.governance.cloudwatch_dashboard_name
}

output "cloudtrail_arn" {
  value = module.governance.cloudtrail_arn
}

output "reports_bucket_name" {
  value = module.compute.reports_bucket_name
}
