variable "account_id" { type = string }
variable "alb_dns_name" { type = string }
variable "alb_enabled" { 
  type    = bool 
  default = true 
}
variable "origin_verify_secret" { type = string }
variable "enable_cloudfront" {
  type    = bool
  default = false
}

# S3 Bucket for Frontend Single-Page App Static Assets
resource "aws_s3_bucket" "frontend" {
  bucket        = "pulsewatch-frontend-${var.account_id}"
  force_destroy = true
}

resource "aws_s3_bucket_website_configuration" "frontend" {
  bucket = aws_s3_bucket.frontend.id

  index_document {
    suffix = "index.html"
  }

  error_document {
    key = "index.html"
  }
}

resource "aws_s3_bucket_public_access_block" "frontend" {
  bucket                  = aws_s3_bucket.frontend.id
  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "frontend_public_read" {
  depends_on = [aws_s3_bucket_public_access_block.frontend]
  bucket     = aws_s3_bucket.frontend.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "PublicReadGetObject"
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.frontend.arn}/*"
    }]
  })
}

# Optional CloudFront Distribution (toggle-able via enable_cloudfront)
resource "aws_cloudfront_origin_access_control" "frontend_oac" {
  count                             = var.enable_cloudfront ? 1 : 0
  name                              = "pulsewatch-frontend-oac"
  description                       = "OAC for PulseWatch private frontend S3 bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "cdn" {
  count               = var.enable_cloudfront ? 1 : 0
  enabled             = true
  is_ipv6_enabled     = true
  default_root_object = "index.html"
  comment             = "PulseWatch CloudFront Edge Distribution"

  origin {
    domain_name              = aws_s3_bucket.frontend.bucket_regional_domain_name
    origin_id                = "S3-pulsewatch-frontend"
    origin_access_control_id = aws_cloudfront_origin_access_control.frontend_oac[0].id
  }

  dynamic "origin" {
    for_each = var.alb_enabled && var.alb_dns_name != "" ? [1] : []
    content {
      domain_name = var.alb_dns_name
      origin_id   = "ALB-pulsewatch-api"

      custom_origin_config {
        http_port              = 80
        https_port             = 443
        origin_protocol_policy = "http-only"
        origin_ssl_protocols   = ["TLSv1.2"]
      }

      custom_header {
        name  = "X-PulseWatch-Origin-Verify"
        value = var.origin_verify_secret
      }
    }
  }

  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-pulsewatch-frontend"

    forwarded_values {
      query_string = false
      cookies { forward = "none" }
    }

    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 3600
    max_ttl                = 86400
    compress               = true
  }

  ordered_cache_behavior {
    path_pattern     = "/api/*"
    allowed_methods  = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "ALB-pulsewatch-api"

    forwarded_values {
      query_string = true
      headers      = ["*"]
      cookies { forward = "all" }
    }

    viewer_protocol_policy = "https-only"
    min_ttl                = 0
    default_ttl            = 0
    max_ttl                = 0
  }

  custom_error_response {
    error_code            = 403
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  custom_error_response {
    error_code            = 404
    response_code         = 200
    response_page_path    = "/index.html"
    error_caching_min_ttl = 10
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = { Name = "pulsewatch-cloudfront-cdn" }
}

output "cloudfront_domain_name" { 
  value = var.enable_cloudfront && length(aws_cloudfront_distribution.cdn) > 0 ? aws_cloudfront_distribution.cdn[0].domain_name : "" 
}
output "cloudfront_id" { 
  value = var.enable_cloudfront && length(aws_cloudfront_distribution.cdn) > 0 ? aws_cloudfront_distribution.cdn[0].id : "" 
}
output "frontend_bucket_name" { value = aws_s3_bucket.frontend.id }
output "s3_website_endpoint" { value = aws_s3_bucket_website_configuration.frontend.website_endpoint }
