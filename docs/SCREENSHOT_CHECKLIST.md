# PulseWatch: Academic Report & Viva Screenshot Checklist

This checklist maps each visual evidence artifact directly to the corresponding figure in the academic report (`docs/ACADEMIC_REPORT.md`, Appendix C, Table 12: Figures 4 through 12). 

Use this guide to capture high-resolution screenshots from the AWS Management Console and web application prior to formatting the final Word/PDF submission or presenting during the oral viva defense.

---

## Visual Evidence & Figure Mapping Table

| Report Figure # | Screenshot Target / Console Location | Target Filename | What to Highlight for Evaluators |
| :---: | :--- | :--- | :--- |
| **Figure 4** | **PulseWatch Web Dashboard**<br>URL: `http://pulsewatch-frontend-8269-XXXX-8995.s3-website.ap-south-1.amazonaws.com` | `screenshot_01_dashboard_healthy.png` | Live monitors in `UP` state with steady green heartbeats, 24-hour uptime percentage (100.0%), and sparkline response latencies (~2–12 ms). |
| **Figure 5** | **System Reactor & Worker Fleet**<br>Web URL: `#/system` on web dashboard | `screenshot_02_system_reactor.png` | Live IMDSv2 metadata (`i-087e1cef16884f5f5`, Availability Zone `ap-south-1a`), SQS message backlog depth (0 visible), and active worker instances (`1 / 3 Nodes Active`). |
| **Figure 6** | **AWS Step Functions Execution Graph**<br>Console: Step Functions -> State machines -> `pulsewatch-incident-workflow` -> Executions | `screenshot_03_stepfunctions_workflow.png` | Full execution workflow graph showing the state sequence: `MarkSuspected` $\to$ `WaitBeforeRecheck` $\to$ `ExecuteRecheck` $\to$ `ConfirmDownState` $\to$ `MarkResolved` with green completion status. |
| **Figure 7** | **Amazon CloudWatch Unified Dashboard**<br>Console: CloudWatch -> Dashboards -> `pulsewatch-overview` | `screenshot_04_cloudwatch_dashboard.png` | Single-pane operational widgets: ALB Request Count & Target Response Time, SQS Approximate Visible Messages, RDS CPU Utilization %, and custom `PulseWatch/Metrics` `SitesDown` metric. |
| **Figure 8** | **Amazon RDS PostgreSQL & DynamoDB Storage**<br>Console: RDS -> Databases (`pulsewatch-db`) & DynamoDB -> Tables (`pulsewatch-checks`) | `screenshot_05_databases_polyglot.png` | Polyglot persistence: Private single-AZ `db.t4g.micro` PostgreSQL 15 database instance alongside DynamoDB on-demand tables with 30-day TTL and DynamoDB Streams enabled. |
| **Figure 9** | **Amazon SNS Alert Notification Email**<br>Recipient Inbox / Email Client | `screenshot_06_sns_email_alert.png` | Production incident notification email dispatched by SNS upon confirmed failure, displaying monitor name, endpoint URL, timestamp, and HTTP error code. |
| **Figure 10** | **AWS Config Compliance Evaluation Console**<br>Console: AWS Config -> Rules | `screenshot_07_governance_compliance.png` | Automated continuous compliance evaluation status across managed rules: `encrypted-volumes`, `restricted-ssh`, and `s3-bucket-ssl-requests-only`. |
| **Figure 11** | **AWS Budgets Spend Tracking Console**<br>Console: Billing and Cost Management -> Budgets | `screenshot_08_aws_budgets.png` | Monthly cost threshold configured at $35.00 with proactive automated notification thresholds at 50%, 80%, and 100% of budgeted spend. |
| **Figure 12** | **Amazon S3 Tiered Lifecycle Management Console**<br>Console: S3 -> Buckets -> `pulsewatch-reports-8269-XXXX-8995` -> Management | `screenshot_09_s3_lifecycle_rules.png` | Dedicated KMS-encrypted reports bucket lifecycle rule `reports-tiered-retention` showing 30-day Standard-IA transition, 90-day Glacier Flexible Retrieval transition, 365-day expiration, and 7-day multipart upload abort. |

---

## Instructions for Report Formatting & Viva Preparation

1. **Storage Directory**:
   Store all captured PNG images in `docs/screenshots/` (e.g., `docs/screenshots/screenshot_01_dashboard_healthy.png`).
2. **Resolution & Crop**:
   Capture screenshots at standard 1080p resolution (1920x1080) or with high-DPI browser scaling. Ensure sensitive personal credentials and session tokens are masked.
3. **Word / PDF Placement**:
   When formatting `docs/ACADEMIC_REPORT.md` into Microsoft Word or LaTeX/PDF, replace the figure placeholders in the text or append the screenshots under **Appendix C: System Verification Artifact and Visual Evidence Index**, labeling each image with its exact figure title and caption:
   - *Figure 4: PulseWatch Real-Time Operational Monitoring Dashboard.*
   - *Figure 5: System Reactor Panel Displaying IMDSv2 Metadata and Fleet Telemetry.*
   - *Figure 6: AWS Step Functions Execution Visual Graph for Outage Verification and Recovery.*
   - *Figure 7: Amazon CloudWatch Unified Operational Monitoring Dashboard.*
   - *Figure 8: Polyglot Persistence Architecture: Amazon RDS PostgreSQL and Amazon DynamoDB.*
   - *Figure 9: Amazon SNS Critical Incident Outage Notification Email.*
   - *Figure 10: AWS Config Continuous Governance and Compliance Evaluation Dashboard.*
   - *Figure 11: AWS Budgets Monthly Financial Allocation and Spend Tracking.*
   - *Figure 12: Amazon S3 Dedicated Reports Storage Tiered Lifecycle Management Configuration.*
