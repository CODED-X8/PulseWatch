# Add direct ALB forward listener for when CloudFront is disabled / verifying
resource "aws_lb_listener_rule" "forward_direct" {
  count        = var.alb_enabled ? 1 : 0
  listener_arn = aws_lb_listener.http[0].arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api[0].arn
  }

  condition {
    path_pattern {
      values = ["/api/*"]
    }
  }
}
